# 倾向行业界面复测

测试全部使用合成目录、账户和显式 mock 请求适配器，不调用真实插件、行情源、调度或消息发送。

## 启动与运行

1. 在仓库根目录运行：

   ```sh
   python3 -m http.server 38759 --bind 127.0.0.1
   ```

2. 用测试浏览器打开下面的浅色页面，再把真实页面视口设为 `320 × 1100`：

   ```text
   http://127.0.0.1:38759/tests/industry-preferences-fixture.html?theme=light
   ```

3. 将 `tests/industry-preferences-browser.js` 的完整内容作为异步函数传给浏览器的 `evaluate`。也可以在此合成页面的开发者控制台运行：

   ```js
   const source = await (await fetch('/tests/industry-preferences-browser.js')).text();
   const result = await (0, eval)('(' + source + ')')();
   console.log(result);
   ```

4. 导航到同一路径的 `?theme=dark`，保持 `320 × 1100` 视口，重新运行同一脚本。每次复测先重新加载合成页面，避免上一轮测试状态干扰结果。
5. 读取返回的 `passed`、`total`、`viewport`、`results`。预期浅色和深色各 `25/25`，且 `viewport` 必须等于 `320`。结果也显示在页面底部及 `window.industryPreferencesAcceptance`。
6. 测试完成后停止本次启动的 HTTP 服务；不用改变系统浏览器、代理或真实插件设置。

## 覆盖范围

- 热门前120与手动选择的明确边界，热门预览不超过120项。
- 名称及代码搜索、分页、多选、移除入口、选择计数、配置保存与回读。
- 空手动选择拒绝写入，切换模式保留手动草稿，旧配置与目录失败保留选择。
- 第一页返回目录 `catalogToken`，后续页携带同一 token。
- 明确重读使用 `refresh:true`，新快照的后续页使用新 token。
- `setState` 切换资料模式时清理旧 token；迟到回包不覆盖新配置。
- 320px 浅色及深色主题下无横向溢出。

此验证属于合成浏览器界面验收。真实数据源、插件安装、历史清理和市场提审须另按原生回执核对。
