# 卡柜 Cardcase

一个把泡泡玛特卡片拍成照片、校正成正立卡片并按系列陈列的手机网页应用。离线可用，可添加到主屏幕。

> 非官方粉丝项目，与泡泡玛特无关。

## 功能

- **拍照 / 选图导入**：拍照或从相册选图，把卡片图片放进卡柜。
- **四角透视校正**：拖动四个角，把斜拍的卡片校正成正立的矩形。
- **按系列陈列**：卡片按系列分开展示，顶部统计总数、系列数、隐藏数。
- **隐藏款发光**：隐藏款带可辨识的金色发光，常规款没有。
- **整柜导出 / 导入 JSON**：一键导出全部卡片和图片，换手机或清空前用它备份；导入支持合并或替换。
- **分享海报**：把某张卡生成海报图片分享。
- **离线可用**：首次打开后断网仍能浏览已入柜的卡。
- **添加到主屏幕**：PWA，安装后像普通 App 一样全屏打开。

## 本地运行

```bash
npm run dev
```

浏览器打开 <http://localhost:5173>。

## 测试

```bash
node --test tests/
```

共 16 个测试，覆盖几何校正、模型、查询等模块。

## 目录结构

```
index.html            页面骨架
manifest.webmanifest  PWA 清单
sw.js                 Service Worker（离线壳缓存）
js/                   前端逻辑（app/ui/db/model/query/geom/image/...）
styles/               样式（tokens.css + app.css）
assets/               图标
tests/                单元测试
scripts/dev-server.mjs 本地静态服务器
docs/                 文档
```

## 数据说明

- 数据只存在浏览器本地（IndexedDB），不上传任何服务器。
- Safari 对长期不打开的站点可能清理本地数据，请「添加到主屏幕」并定期导出备份。
- 换手机靠导出 JSON：先「导出整柜」，新手机上「导入」即可。

## 部署到 GitHub Pages

两种方式任选其一：

1. **网页上传**：在 GitHub 上把整个项目上传到 `cardcase` 仓库，然后进 Settings → Pages，Source 选 `main` 分支、`/ (root)` 目录。
2. **命令行**：

   ```bash
   gh repo create cardcase --public --source=. --remote=origin --push
   gh api -X POST repos/dmqm/cardcase/pages \
     -f "source[branch]=main" -f "source[path]=/"
   ```

   构建完成后访问 <https://dmqm.github.io/cardcase/>。

## 版权与免责

非官方粉丝项目，与泡泡玛特无关；不包含任何官方素材，卡片图片均由使用者自行拍摄。
