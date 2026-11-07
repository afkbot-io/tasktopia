# Сохранение двух стрелок при native sampling

Второй source сохранил широкий циферблат, но vertical hand исчезла в16×16
при nearest-neighbour sampling. Применена отдельная imagegen-корректировка
самого источника; normalized PNG не дорисовывался.

Change ONLY the dark clock hands inside the pale dial. Preserve the same station clock housing, shape, camera, colors, slim short post and foot, transparent background and position. The two clock hands must be a clearly visible chunky L after reduction to a tiny16x16 game sprite: make the UP arm about2artistic pixels WIDE by3pixels HIGH, and the RIGHT arm about3pixels WIDE by2pixels HIGH, joined at one shared central corner. Both arms dark slate, no circle or dot. Together the L occupies about60percent of the cream dial's width and height, with pale empty margin all around. At the exported scale the vertical stroke must be broad enough not to vanish under nearest-neighbour reduction. Keep the broad head10pixels wide, whole object14pixels tall, native canvas16x16 with bottomcenter anchor8,16, hard square pixel blocks and at most8opaque colors. No text/numbers, no extra markings, no glow, no gradient, no blur, no antialiasing, no other changes.
