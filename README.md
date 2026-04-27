# 抖音评论抓取工具

本项目是一个本地 Node.js 评论抓取脚本。给一个视频 ID，可以抓取一级评论和二级评论，并输出成嵌套 JSON。

## 隐私说明

`cookie.txt` 不会上传到 GitHub。使用前请复制示例文件，并填入你自己的抖音 cookie：

```powershell
Copy-Item .\cookie.example.txt .\cookie.txt
```

`api.txt` 也不会上传，因为里面可能包含你抓包时得到的参数。使用前请复制示例文件，并填入你自己抓到的接口模板：

```powershell
Copy-Item .\api.example.txt .\api.txt
```

## 快速使用

```powershell
node .\douyin_crawler_server.js 7626423682646326117 --limit=500
```

默认输出位置：

```text
outputs/douyin_comments_7626423682646326117.json
```

## 常用参数

- `--limit=500`：最多抓取多少条一级评论。
- `--reply-limit=50`：每条一级评论下面最多抓取多少条二级评论。不传时默认尽量抓完。
- `--page-size=20`：每次请求的分页数量。
- `--output=xxx.json`：自定义输出文件路径。

示例：

```powershell
node .\douyin_crawler_server.js 7626423682646326117 --limit=500 --reply-limit=50
```

## 当前目录

- `douyin_crawler_server.js`：主入口，平时只运行这个文件。
- `cookie.example.txt`：cookie 示例文件，真实 `cookie.txt` 需要自己创建。
- `api.example.txt`：接口模板示例文件，真实 `api.txt` 需要自己创建。
- `bdm_sign_vm.js`：本地签名脚本，主要用于一级评论接口签名。
- `bdm_live.js`、`bdm.js`：签名依赖文件，`bdm.js` 是备用。
- `outputs/`：抓取结果 JSON，默认不会上传。
- `CODE_LOGIC.md`：代码逻辑说明。

## 输出结构

每条一级评论是一个对象。如果它下面有二级评论，会多一个 `replies` 数组：

```json
[
  {
    "cid": "一级评论ID",
    "text": "评论内容",
    "user_id": "评论人ID",
    "user_name": "评论人昵称",
    "ip_label": "IP属地",
    "digg_count": 10,
    "replies": [
      {
        "cid": "二级评论ID",
        "text": "二级评论内容",
        "user_name": "评论人昵称",
        "ip_label": "IP属地",
        "digg_count": 0
      }
    ]
  }
]
```

如果一级评论没有二级评论，就不会写 `replies` 字段。
