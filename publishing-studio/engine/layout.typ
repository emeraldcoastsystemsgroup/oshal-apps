// Trusted JSON only. This file owns all text shaping and paragraph flow.
#let data = json(sys.inputs.at("data"))
#set document(title: data.at("title", default: "Publishing Studio"), author: "")
#set page(width: data.width * 1pt, height: data.height * 1pt, margin: 0pt)
#set text(font: "Libertinus Serif", fallback: false, lang: "en", hyphenate: false)
#let colored(c) = rgb(..c)
#let styled(run, paragraph) = {
  let s = data.characterStyles.at(run.at("style", default: "default"))
  text(font: s.font, size: s.size * 1pt, weight: s.weight, style: s.style,
    fill: colored(s.color), run.text)
}
#let paragraph(p) = {
  let s = data.paragraphStyles.at(p.style)
  let body = p.runs.map(r => styled(r, s)).join()
  // Genuine renderer measurements block single-word/glyph clipping. Wrapping
  // and complete-story page count are still the native renderer's decisions.
  context {
    for word in p.words {
      let rendered = word.map(r => styled(r, s)).join()
      let box = measure(rendered)
      assert(box.width <= (data.width - s.indent) * 1pt, message: "publishing_unbreakable_word_overflow")
      assert(box.height <= data.height * 1pt, message: "publishing_glyph_height_overflow")
    }
  }
  let alignment = (left: left, center: center, right: right).at(s.align)
  block(above: 0pt, below: s.spaceAfter * 1pt, {
    set par(leading: s.leading * 1pt, spacing: 0pt, first-line-indent: s.indent * 1pt)
    set align(alignment)
    body
  })
}
#if data.mode == "story" {
  for p in data.paragraphs { paragraph(p) }
} else {
  for object in data.objects {
    place(top + left, dx: object.x * 1pt, dy: object.y * 1pt, {
      if object.kind == "text" {
        block(width: object.width * 1pt, height: object.height * 1pt,
          clip: true, paragraph(object.paragraph))
      } else if object.kind == "image" {
        image(object.path, width: object.width * 1pt, height: object.height * 1pt, fit: "stretch")
      } else if object.kind == "rect" {
        rect(width: object.width * 1pt, height: object.height * 1pt, fill: colored(object.color), stroke: none)
      }
    })
  }
  // Empty masters remain one genuine native page.
  box(width: 0pt, height: 0pt)
}
