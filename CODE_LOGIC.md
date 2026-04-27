# 代码逻辑说明

## 总体流程

入口文件是 `douyin_crawler_server.js`。运行命令时传入视频 ID：

```powershell
node .\douyin_crawler_server.js 视频ID --limit=500
```

脚本会按下面的顺序执行：

1. 读取命令行参数。
2. 从 `cookie.txt` 读取你自己的 cookie。
3. 从项目里的 `api.txt` 读取接口模板。
4. 抓取一级评论。
5. 对有回复数的一级评论继续抓取二级评论。
6. 简化评论字段。
7. 写入 `outputs/douyin_comments_视频ID.json`。

## 核心文件

### `douyin_crawler_server.js`

主抓取脚本，负责解析参数、读取配置、构造请求、调用签名、翻页抓评论和写入 JSON。

### `bdm_sign_vm.js`

本地签名脚本，负责给一级评论接口生成新的 `a_bogus`。

它会在 Node.js 的 `vm` 里模拟浏览器环境，加载 `bdm_live.js` 或 `bdm.js`，然后触发 `bdms` 对 URL 进行签名。

### `api.txt`

`api.txt` 会随项目一起提供。

它保存两个接口模板：

- 第 1 行：二级评论接口 `/aweme/v1/web/comment/list/reply/`
- 第 2 行：一级评论接口 `/aweme/v1/web/comment/list/`

主脚本会替换里面的视频 ID、评论 ID、分页 cursor 和 count。

### `cookie.txt`

真实 `cookie.txt` 不上传到 GitHub，需要使用者自己准备。可以从 `cookie.example.txt` 复制一份再填入自己的 cookie。

脚本默认从这个文件读取，也支持用环境变量 `DOUYIN_COOKIE` 覆盖。

## 一级评论抓取逻辑

对应函数：`crawlTopComments`

流程：

1. 读取 `api.txt` 第 2 行作为一级评论接口模板。
2. 替换 `aweme_id` 为命令行传入的视频 ID。
3. 替换 `cursor` 和 `count`。
4. 删除旧的 `a_bogus`、`timestamp`、`x-secsdk-web-signature`。
5. 调用 `signUrl` 重新生成签名 URL。
6. 请求接口，读取 `comments`。
7. 保存评论数据和该评论的二级评论数量。
8. 根据接口返回的 `cursor` 和 `has_more` 继续翻页。

一级评论需要本地重新签名，否则换视频 ID 或翻页时容易失效。

## 二级评论抓取逻辑

对应函数：`crawlReplies`

流程：

1. 读取 `api.txt` 第 1 行作为二级评论接口模板。
2. 替换 `item_id` 为视频 ID。
3. 替换 `comment_id` 为一级评论 ID。
4. 替换 `cursor` 和 `count`。
5. 保留接口模板里的可用 `a_bogus`。
6. 请求接口，读取二级评论。
7. 根据 `cursor` 和 `has_more` 继续翻页。

这里没有走本地重新签名，是因为测试发现二级评论接口用本地签名会触发 BDTuring，而复用 `api.txt` 中捕获到的二级评论 `a_bogus` 可以跨评论 ID、跨视频 ID、跨分页正常使用。

## 字段精简逻辑

对应函数：`simplifyComment`

原始评论对象字段很多，脚本只保留这些：

- `cid`：评论 ID。
- `text`：评论内容。
- `user_id`：评论人 ID。
- `user_sec_uid`：评论人 sec_uid。
- `user_unique_id`：评论人抖音号，如果接口返回了就保留。
- `user_name`：评论人昵称。
- `ip_label`：IP 属地。
- `digg_count`：点赞数。

空值字段会被自动删除。

## 输出 JSON 结构

最终输出是一级评论数组。二级评论会写在对应一级评论下面：

```json
[
  {
    "cid": "一级评论ID",
    "text": "一级评论内容",
    "user_name": "昵称",
    "ip_label": "广东",
    "digg_count": 12,
    "replies": [
      {
        "cid": "二级评论ID",
        "text": "二级评论内容",
        "user_name": "昵称",
        "ip_label": "北京",
        "digg_count": 0
      }
    ]
  }
]
```

没有二级评论的一级评论不会写 `replies` 字段。

## 注意事项

- `cookie.txt` 过期后需要重新更新。
- 不要把自己的 `cookie.txt` 上传到公开仓库。
- `api.txt` 中第 1 行的二级评论接口模板很关键，不要清空。
- 如果一级评论接口被拦，优先检查 cookie 和 `bdm_live.js` 是否还可用。
- 输出目录默认是 `outputs/`，输出 JSON 不会上传到 GitHub。
