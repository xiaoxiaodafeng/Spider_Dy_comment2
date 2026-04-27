const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const API_PATH = path.join(__dirname, "api.txt");
const SIGNER_PATH = path.join(__dirname, "bdm_sign_vm.js");
const COOKIE_PATH = path.join(__dirname, "cookie.txt");

function cliOption(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function cliFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  console.log("Usage:");
  console.log("  node .\\douyin_crawler_server.js VIDEO_ID --limit=500");
  console.log("");
  console.log("Options:");
  console.log("  --limit=500          max top-level comments");
  console.log("  --reply-limit=200    max replies per top-level comment, default all");
  console.log("  --page-size=20       page size");
  console.log("  --output=file.json   output file, default outputs/douyin_comments_VIDEO_ID.json");
}

function readCookie() {
  if (process.env.DOUYIN_COOKIE) return process.env.DOUYIN_COOKIE.trim();
  if (fs.existsSync(COOKIE_PATH)) return fs.readFileSync(COOKIE_PATH, "utf8").trim();
  throw new Error("Missing cookie. Put cookie in cookie.txt or set DOUYIN_COOKIE.");
}

function readApiUrl(line) {
  const urls = fs
    .readFileSync(API_PATH, "utf8")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = urls[line - 1];
  if (!selected) throw new Error(`api.txt does not contain URL line ${line}`);
  return selected;
}

function buildHeaders(cookie) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en,zh-CN;q=0.9,zh;q=0.8,zh-TW;q=0.7",
    referer: "https://www.douyin.com/",
    "user-agent":
      cliOption(
        "ua",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      ),
    cookie,
  };
}

function cleanUnsignedUrl(rawUrl, awemeId, commentId, cursor, count) {
  const url = new URL(rawUrl);
  url.searchParams.delete("a_bogus");
  url.searchParams.delete("timestamp");
  url.searchParams.delete("x-secsdk-web-signature");

  if (url.searchParams.has("aweme_id")) url.searchParams.set("aweme_id", awemeId);
  if (url.searchParams.has("item_id")) url.searchParams.set("item_id", awemeId);
  if (commentId && url.searchParams.has("comment_id")) url.searchParams.set("comment_id", commentId);

  url.searchParams.set("cursor", String(cursor));
  url.searchParams.set("count", String(count));
  return url.href;
}

function buildCapturedSignedUrl(rawUrl, awemeId, commentId, cursor, count) {
  const url = new URL(rawUrl);
  url.searchParams.delete("timestamp");
  url.searchParams.delete("x-secsdk-web-signature");

  if (url.searchParams.has("aweme_id")) url.searchParams.set("aweme_id", awemeId);
  if (url.searchParams.has("item_id")) url.searchParams.set("item_id", awemeId);
  if (commentId && url.searchParams.has("comment_id")) url.searchParams.set("comment_id", commentId);

  url.searchParams.set("cursor", String(cursor));
  url.searchParams.set("count", String(count));
  return url.href;
}

function signUrl(rawUrl) {
  const bdm = fs.existsSync(path.join(__dirname, "bdm_live.js")) ? "bdm_live.js" : "bdm.js";
  const pageUrl = "https://www.douyin.com/";
  const result = spawnSync(process.execPath, [SIGNER_PATH, rawUrl, "--drop-secsdk", `--bdm=${bdm}`, `--page-url=${pageUrl}`], {
    cwd: __dirname,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "signer failed").trim());
  }

  const match = result.stdout.match(/^signed_url\s*=\s*(.+)$/m);
  if (!match) throw new Error("signer output did not contain signed_url");
  return match[1].trim();
}

async function requestJson(url, cookie) {
  const response = await fetch(url, { headers: buildHeaders(cookie) });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const bdturing = response.headers.has("x-vc-bdturing-parameters");

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Non-JSON response: status=${response.status}, content-type=${contentType}, bdturing=${bdturing}`,
    );
  }

  return JSON.parse(text);
}

function simplifyComment(comment) {
  const user = comment.user || {};
  const item = {
    cid: comment.cid,
    text: comment.text,
    user_id: user.uid,
    user_sec_uid: user.sec_uid,
    user_unique_id: user.unique_id,
    user_name: user.nickname,
    ip_label: comment.ip_label,
    digg_count: comment.digg_count,
  };

  for (const key of Object.keys(item)) {
    if (item[key] === undefined || item[key] === null || item[key] === "") delete item[key];
  }

  return item;
}

async function crawlTopComments({ awemeId, limit, pageSize, cookie }) {
  const baseUrl = readApiUrl(2);
  const items = [];
  let cursor = 0;
  let hasMore = 1;

  while (items.length < limit && hasMore) {
    const count = Math.min(pageSize, limit - items.length);
    const unsignedUrl = cleanUnsignedUrl(baseUrl, awemeId, "", cursor, count);
    const signedUrl = signUrl(unsignedUrl);
    const json = await requestJson(signedUrl, cookie);
    const comments = Array.isArray(json.comments) ? json.comments : [];

    for (const comment of comments) {
      if (items.length >= limit) break;
      items.push({
        cid: comment.cid,
        data: simplifyComment(comment),
        replyTotal: Number(comment.reply_comment_total || comment.comment_reply_total || 0),
      });
    }

    const nextCursor = Number(json.cursor || 0);
    hasMore = Number(json.has_more || 0);
    if (!hasMore || comments.length === 0 || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return items;
}

async function crawlReplies({ awemeId, commentId, limit, pageSize, cookie }) {
  const baseUrl = readApiUrl(1);
  const replies = [];
  let cursor = 0;
  let hasMore = 1;

  while (replies.length < limit && hasMore) {
    const count = Math.min(pageSize, limit - replies.length);
    const signedUrl = buildCapturedSignedUrl(baseUrl, awemeId, commentId, cursor, count);
    const json = await requestJson(signedUrl, cookie);
    const comments = Array.isArray(json.comments) ? json.comments : [];

    for (const comment of comments) {
      if (replies.length >= limit) break;
      replies.push(simplifyComment(comment));
    }

    const nextCursor = Number(json.cursor || 0);
    hasMore = Number(json.has_more || 0);
    if (!hasMore || comments.length === 0 || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return replies;
}

async function main() {
  const awemeId = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!awemeId || cliFlag("help") || cliFlag("h")) {
    usage();
    return;
  }

  const limit = Number(cliOption("limit", "500"));
  const replyLimit = Number(cliOption("reply-limit", "999999"));
  const pageSize = Number(cliOption("page-size", "20"));
  const output = cliOption("output", path.join("outputs", `douyin_comments_${awemeId}.json`));
  const cookie = readCookie();

  console.log(`video_id=${awemeId}`);
  console.log(`limit=${limit}`);
  console.log(`reply_limit=${replyLimit}`);

  const topComments = await crawlTopComments({ awemeId, limit, pageSize, cookie });
  const comments = topComments.map((item) => ({ ...item.data }));

  if (replyLimit > 0) {
    const byCid = new Map(comments.map((item) => [item.cid, item]));
    for (let index = 0; index < topComments.length; index += 1) {
      const item = topComments[index];
      if (item.replyTotal <= 0) continue;

      const parent = byCid.get(item.cid);
      const maxReplies = Math.min(replyLimit, item.replyTotal);
      const replies = await crawlReplies({
        awemeId,
        commentId: item.cid,
        limit: maxReplies,
        pageSize,
        cookie,
      });
      if (replies.length > 0) parent.replies = replies;
      console.log(`reply ${index + 1}/${topComments.length}: cid=${item.cid}, replies=${replies.length}`);
    }
  }

  const target = path.resolve(__dirname, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(comments, null, 2)}\n`, "utf8");

  console.log(`output=${target}`);
  console.log(`top_comments=${comments.length}`);
  console.log(`replies_collected=${comments.reduce((sum, item) => sum + (item.replies ? item.replies.length : 0), 0)}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
