# dsh-task-center

> 跑在 DeepSeek Harness 里的看板式任务中心：一块四列 Web 面板，加上一组让 agent 直接读写任务的工具。

*A kanban task center plugin for DeepSeek Harness — a Web panel plus agent tools.*

<img src="icon.svg" width="72" alt="dsh-task-center icon">

## 功能

- **四列看板**：待办 / 进行中 / 阻塞 / 已完成，另有清单视图按状态筛选
- **卡片**：左侧优先级色条、标签 chip、截止日期按「今天 / 已逾期 / 将来」分色
- **子任务**：一层嵌套，父任务进回收站时整棵树一起走
- **回收站**：软删除、按根任务恢复、彻底清除
- **交互**：搜索、详情抽屉右滑入、`focus-visible` 焦点环、空状态占位
- **主题**：只用 `--dsw-alias-*` 设计令牌，明暗主题自动跟随，无字面色

## 环境要求

- DeepSeek Harness 桌面端（需要插件 / bundle 支持）
- 构建与测试需要 Node `^22.19.0 || >=24.0.0`

## 安装

仓库里 `index.js` 与 `client.js` 是已构建的产物，clone 下来即可直接使用，不需要先构建。

**方式 A（推荐，交给 agent）**

```bash
git clone https://github.com/Mashiro707/dsh-task-center.git
```

然后在 DSH 里对 agent 说：

> 用 plugin_manager 的 install_bundle，把 `<clone 下来的目录>` 装进当前 profile。

**方式 B（手动链接）**

在 profile 目录（`$DSH_HOME/profiles/<name>/`）里：

1. `package.json` 的 `dependencies` 加 `"dsh-task-center": "link:<包目录绝对路径>"`
2. `package.json` 的 `dsh.profile.bundles` 数组加 `"dsh-task-center"`
3. `cordis.yml` 里加一条行（包内 `cordis.patch.yml` 就是这段内容）：

   ```yaml
   - id: dsh-task-center
     name: 'dsh-task-center'
   ```

4. 在 profile 目录执行 `npm install` 建好链接

安装后重启 DSH 进程，侧边栏出现任务中心入口。浏览器半刷新页面即可生效，宿主半必须重启进程。

## 使用

面板：四列拖拽不支持的场景用状态选择器改列；卡片点开是详情抽屉；顶部搜索框按标题、备注、标签过滤。

### agent 工具

| 工具 | 作用 | 主要参数 |
| --- | --- | --- |
| `task_list` | 列出任务（子任务挂在父任务下）与回收站 | `status` / `tag` / `query` / `include_trash` |
| `task_create` | 新建任务 | `title`（必填）/ `notes` / `status` / `priority` / `due` / `tags` / `parent_id` |
| `task_update` | 只改传入的字段 | `id`（必填）+ 同上各字段，`due`、`parent_id` 可传 `null` 清空 |
| `task_delete` | 删除任务（默认进回收站） | `id`（必填）/ `permanent` |

状态：`todo` `doing` `blocked` `done`；优先级：`low` `normal` `high` `urgent`。

### HTTP API

面板与宿主之间走 `POST /task-center/api/<action>`，JSON 请求体。路由只接受来自 loopback 且同源的请求。

## 数据

任务存放在 `$DSH_HOME/task-center/tasks.json`（默认 `~/.dsh/task-center/tasks.json`），单文件 JSON：

- 写入走「临时文件 + rename」，避免半个文件
- 读到损坏的 JSON 会先备份成 `tasks.json.corrupt-<时间戳>`，再重建空文档
- 删除是软删除（记 `deletedAt`），彻底清除才真正移除

## 开发

```bash
npm install
npm run build      # tsc 编译 src/*.ts → 包根的 index.js / client.js
npm run typecheck  # 只做类型检查
npm test           # build + node --test
```

```
src/index.ts            宿主半：Cordis 插件，JSON 存储 + HTTP 路由 + agent 工具
src/client.ts           浏览器半：React（无 JSX）面板
src/types.d.ts          两端共享的领域模型
src/host-globals.d.ts   仅宿主半可见的接口声明
src/client-globals.d.ts 仅浏览器半可见的 require / __ModuleLoader__ 接口
index.js, client.js     构建产物，勿手改
```

### 两条硬约束

1. **`src/client.ts` 里不能出现 `import` / `export`。**
   浏览器半是「脚本」而不是模块：加载器把这个文件当函数体执行，只交给工厂一个 `require`。一旦出现 import/export，TypeScript 会把产物标成模块，插件直接加载失败。所以共享类型写成 `src/types.d.ts` 里的全局声明，而不是 `import type`。

2. **样式只能通过带 `data-plugin` 的 `<style>` 标签注入。**
   `styles` 是「动态 Client half」才有的内置符号，静态安装的插件拿不到（模块表里没有这个 key，`require('styles')` 会抛 `missed the module table`）。模块系统按 `style[data-plugin]` 归属并在卸载时清理。

## 设计说明

- **产物入库**：`index.js` / `client.js` 一起提交，clone 即用。代价是改源码后要重新构建，好处是安装形态和设备上的构建链无关。
- **单文件 JSON 而非数据库**：任务量在几百条以内，单文件足够；原子 rename 换来的是零运维和可读的备份。
- **只依赖 `node:` 内置模块**：运行时不引第三方包，`typescript` 与 `@types/node` 只在开发期存在。

## 许可证

[Apache-2.0](LICENSE)
