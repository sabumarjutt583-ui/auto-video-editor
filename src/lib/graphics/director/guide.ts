import { LIMITS } from "../spec/limits.ts";
import { LAYER_TYPES } from "../spec/schema.ts";

/** The graphic types the AI may use in a normal scene (the others, `image` and `shape`, only as helpers). */
export const MAIN_TYPES = LAYER_TYPES.filter((t) => t !== "image" && t !== "shape" && t !== "icon" && t !== "particles");

/**
 * What the AI is told about the GraphicSpec format. It is written by hand to stay short; the real rules are in
 * src/lib/graphics/spec (the answer is validated against them, so a mistake here never reaches the renderer).
 */
export const SPEC_GUIDE = `GRAPHICSPEC (JSON). Positions and sizes are fractions of the video frame (0 to 1). Times are seconds from the start of the graphic.
{ "schemaVersion": 1, "id": "g1", "duration": 3.5, "layers": [ ...layers ] }   (1 to ${LIMITS.maxLayers} layers, duration 0.3 to ${LIMITS.maxDuration})

Every layer has: "id" (letters, digits, _ -), "type", "box": {"x","y","w","h"} (x+w <= 1, y+h <= 1), and optionally "start" (seconds), "duration", "opacity" (0 to 1),
"enter": {"preset": none|fade|slideUp|slideDown|slideLeft|slideRight|scale|pop|wipe|typewriter, "duration", "delay", "easing"} and "exit": {"preset": none|fade|slideUp|slideDown|slideLeft|slideRight|scale|wipe, "duration"}.
Easing: linear|easeOut|easeInOut|easeOutBack|easeOutExpo|spring. Leave "enter" and "exit" out to use the channel's brand animation.
Colours are names (primary, secondary, accent, text, muted, background, success, danger) or #RRGGBB. Use the names so the brand kit decides the look.

Layer types:
- counter: {"type":"counter","from":0,"to":1200000,"format":"plain|grouped|compact","decimals":0,"prefix":"$","suffix":"%","label":"Total views","size":0.12}
- chart: {"type":"chart","kind":"bar|line|pie|donut","title":"Subscribers","unit":"M","rows":[{"label":"Jan","value":10}, ...] (1 to ${LIMITS.maxChartRows} rows),"highlight":2}
- timeline: {"type":"timeline","orientation":"horizontal|vertical","events":[{"label":"Launch","date":"2019"}, ...] (2 to ${LIMITS.maxTimelineEvents})}
- map: {"type":"map","region":"world|europe|asia|africa|northAmerica|southAmerica|oceania|middleEast","projection":"naturalEarth|mercator|equirectangular|orthographic","countries":[{"code":"PK","label":"Pakistan"}],"pins":[{"name":"Karachi","lat":24.86,"lon":67.0}],"routes":[{"from":{"lat":0,"lon":0},"to":{"lat":0,"lon":0}}],"camera":[{"t":0,"zoom":1},{"t":2.5,"zoom":1.6,"panX":-0.1,"panY":0}]} (needs at least one country, pin or route)
- lowerThird: {"type":"lowerThird","title":"Dr. Amina Khan","subtitle":"Climate scientist","icon":{"set":"lucide","name":"user"}}
- quoteCard: {"type":"quoteCard","quote":"...","author":"..."}
- list: {"type":"list","style":"bullets|numbered|checks","items":[{"text":"First","icon":{"set":"lucide","name":"check"}}, ...] (1 to ${LIMITS.maxListItems})}
- progressBar: {"type":"progressBar","from":0,"to":0.72,"label":"Done","showPercent":true}
- kineticText: {"type":"kineticText","words":["Fast","simple","free"],"style":"pop|slide|highlight","size":0.09}
- flag: {"type":"flag","country":"JP","shape":"rect|circle","label":"Japan"}
- text: {"type":"text","text":"...","size":0.06,"weight":"regular|semibold|bold","align":"left|center|right","maxLines":2,"color":"accent"}
- richText: {"type":"richText","runs":[{"text":"People:"},{"text":"8 billion","weight":"bold","color":"accent"}],"size":0.06}
- icon: {"type":"icon","icon":{"set":"lucide|tabler","name":"users"},"color":"accent"}  (only names from the icon list you are given)
- shape: {"type":"shape","shape":"rect|roundRect|circle|line","fill":"secondary","stroke":"accent","strokeWidth":0.004,"radius":0.2}  (plates behind text)
- particles: {"type":"particles","kind":"confetti|sparks|dust|snow|bubbles","count":60}  (celebrations only)
Text is at most ${LIMITS.maxTextChars} characters per layer. No web addresses, no picture files.

Example (a big number with an icon):
{"schemaVersion":1,"id":"g1","duration":3.5,"layers":[
 {"id":"plate","type":"shape","box":{"x":0.56,"y":0.06,"w":0.38,"h":0.26},"shape":"roundRect","fill":"secondary","opacity":0.85},
 {"id":"icon","type":"icon","box":{"x":0.58,"y":0.1,"w":0.07,"h":0.16},"icon":{"set":"lucide","name":"users"},"color":"accent"},
 {"id":"value","type":"counter","box":{"x":0.66,"y":0.08,"w":0.27,"h":0.22},"from":0,"to":8000000000,"format":"compact","decimals":0,"label":"people","size":0.12}]}`;
