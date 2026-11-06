# Исправление читаемости часов

Первый источник отклонён: после source-preserving уменьшения циферблат теряет
стрелки, предмет читается как фонарь. Он сохранён только в локальном QA evidence и не
входит в runtime/manifest. Второй источник — отдельная корректировка через
встроенный imagegen; исходная геометрия не дорисовывается кодом.

Edit this isolated station-clock sprite for native16x16 city use. Keep its muted slate/cream/ochre palette, orthographic frontal-top high45 camera, upper-left light, hard blocky pixels, transparent background, centered short foot and single-object composition. Change proportions: make the clock head much broader and dominant, approximately10artistic pixels wide by9pixels tall; a clear cream dial7x6pixels inside, with TWO distinct dark short hands (one up, one right, simple right-angle L) each at least2native pixels and1pixel thick. Use a very SHORT steel mast only3pixels high, foot2pixels high. Entire occupied sprite about10wide by14high, bottomcenter contact on16x16canvas. The dial must remain recognizable as a CLOCK at native16x16, not a lamp/traffic light. Keep the broad head square with minimally stepped corners and a single thin top-plane highlight, no rounded emoji or dome. Mast and foot centered under head. No numerals, written text, logos, ground, shadows, props, gradients, gloss, blur, antialiasing or new decorative elements. Large exported pixels should be completely flat square blocks as a magnified16x16sprite; native palette maximum8opaque colors.
