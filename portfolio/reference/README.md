# 参考与素材源目录

`reference/` 不是浏览器静态路径，页面不能直接引用其中的文件。按用途分开存放：

- [`asset-sources/`](asset-sources/README.md)：生成或复制到 `public/` 的用户提供素材源。源文件与运行时副本允许相同，不能因重复而删除源文件。
- [`research/`](research/README.md)：以后存放研究参考；按图片、文档（含 PDF）与其他格式细分。

浏览器运行时素材位于 `public/images/`，页面使用以 `/images/` 开头的路径。已确认的源文件、运行时衍生文件、尺寸、生成方式和权利来源见 [`../ASSET-SOURCES.md`](../ASSET-SOURCES.md)。

新增或替换素材前，先更新 `ASSET-SOURCES.md`，再按其中的生成合同写入对应运行时路径。不要凭此说明推定目录中存在某个头像、封面或其他源文件。
