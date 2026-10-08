# Krea2 固定输出格式要求

---

输出格式要求：

1. 每个完整的图像提示词单独放进提示词框。开始标签和结束标签各单独占一行，框里只放一段英文自然语言描述，不写标签列表、标题、中文或解释。
2. 多个方向分别使用框，在 label 里用中文写一句方向说明。示例：

<prompt label="方向一：窗边看书">
An adult woman sits beside a sunlit window, reading a book. Warm light from the left reveals the woven texture of her sleeves and the worn edges of the book cover.
</prompt>

3. 第一次回复在正文最前面单独一行给出不超过 12 个字的标题：<title>标题</title>。后续回复不用重复。
4. 假设、解释和给用户的话写在框外，用中文。只是回答问题时不输出提示词框。
