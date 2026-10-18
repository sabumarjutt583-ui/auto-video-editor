use super::model::{AssRequest, CaptionLine, Look, Position, Preset};
use super::text::{color, escape, join_words, time};

/// Words shown together in the Pop preset.
const POP_GROUP: usize = 2;

fn alignment(look: &Look) -> u8 {
    if look.preset == Preset::Documentary {
        // Lower third: bottom left.
        return match look.position {
            Position::Bottom => 1,
            Position::Middle => 4,
            Position::Top => 7,
        };
    }
    match look.position {
        Position::Bottom => 2,
        Position::Middle => 5,
        Position::Top => 8,
    }
}

fn style_line(look: &Look) -> String {
    let boxed = look.preset == Preset::Boxed;
    // Karaoke: the "secondary" color is what has not been spoken yet, the "primary" what has.
    let (primary, secondary) = if look.preset == Preset::Highlight { (&look.highlight, &look.primary) } else { (&look.primary, &look.primary) };
    let outline_color = if boxed { color("#000000", 0x55) } else { color("#000000", 0) };
    let back_color = color("#000000", 0x60);
    let (border_style, outline, shadow) = if boxed { (3, (look.font_size * 0.22).max(6.0), 0.0) } else { (1, look.outline, look.shadow) };
    format!(
        "Style: Default,{font},{size:.0},{primary},{secondary},{outline_color},{back_color},{bold},0,0,0,100,100,0,0,{border_style},{outline:.1},{shadow:.1},{align},{mh},{mh},{mv},1",
        font = look.font,
        size = look.font_size,
        primary = color(primary, 0),
        secondary = color(secondary, 0),
        bold = if look.bold { -1 } else { 0 },
        align = alignment(look),
        mh = look.margin_h,
        mv = look.margin_v,
    )
}

fn shown(look: &Look, text: &str) -> String {
    let text = if look.uppercase { text.to_uppercase() } else { text.to_string() };
    escape(&text)
}

/// The words of a line as one or two lines of text ("\N" between them).
fn plain_text(look: &Look, line: &CaptionLine) -> String {
    let split = line.break_at.filter(|&at| at > 0 && at < line.words.len());
    let join = |from: usize, to: usize| shown(look, &join_words(line.words[from..to].iter().map(|w| w.text.as_str())));
    match split {
        Some(at) => format!("{}\\N{}", join(0, at), join(at, line.words.len())),
        None => join(0, line.words.len()),
    }
}

/// Word highlight: each word gets a karaoke duration up to the start of the next word, so the color
/// moves on without gaps and always matches the voice.
fn karaoke_text(look: &Look, line: &CaptionLine) -> String {
    let split = line.break_at.filter(|&at| at > 0 && at < line.words.len());
    let mut out = String::new();
    let lead = ((line.words.first().map_or(line.start, |w| w.start) - line.start).max(0.0) * 100.0).round() as i64;
    if lead > 0 {
        out.push_str(&format!("{{\\k{lead}}}"));
    }
    let mut previous: Option<char> = None;
    for (i, word) in line.words.iter().enumerate() {
        let next_start = line.words.get(i + 1).map_or(line.end.max(word.end), |n| n.start);
        let cs = ((next_start - word.start).max(0.0) * 100.0).round() as i64;
        let text = shown(look, word.text.trim());
        if text.is_empty() {
            continue;
        }
        if split == Some(i) {
            out.push_str("\\N");
        } else if let (Some(last), Some(first)) = (previous, text.chars().next()) {
            if !(super::text::is_no_space(last) && super::text::is_no_space(first)) {
                out.push(' ');
            }
        }
        out.push_str(&format!("{{\\k{cs}}}{text}"));
        previous = text.chars().last();
    }
    out
}

fn dialogue(start: f64, end: f64, text: &str) -> String {
    format!("Dialogue: 0,{},{},Default,,0,0,0,,{}", time(start), time(end), text)
}

fn events(look: &Look, lines: &[CaptionLine]) -> Vec<String> {
    let mut out = Vec::new();
    for line in lines.iter().filter(|l| !l.words.is_empty() && l.end > l.start) {
        match look.preset {
            Preset::None => {}
            Preset::Highlight => out.push(dialogue(line.start, line.end, &karaoke_text(look, line))),
            Preset::Pop => {
                for (g, group) in line.words.chunks(POP_GROUP).enumerate() {
                    let start = if g == 0 { line.start } else { group[0].start };
                    let next = line.words.get((g + 1) * POP_GROUP).map_or(line.end, |w| w.start);
                    let text = shown(look, &join_words(group.iter().map(|w| w.text.as_str())));
                    let pop = "{\\fscx80\\fscy80\\t(0,120,\\fscx100\\fscy100)}";
                    out.push(dialogue(start, next.max(start + 0.05), &format!("{pop}{text}")));
                }
            }
            Preset::Clean | Preset::Boxed | Preset::Documentary => out.push(dialogue(line.start, line.end, &plain_text(look, line))),
        }
    }
    out
}

/// The whole ASS file for a request.
pub fn build_ass(request: &AssRequest) -> String {
    let mut out = String::new();
    out.push_str("[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\n");
    out.push_str(&format!("PlayResX: {}\nPlayResY: {}\n\n", request.width, request.height));
    out.push_str("[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n");
    out.push_str(&style_line(&request.look));
    out.push_str("\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n");
    for event in events(&request.look, &request.lines) {
        out.push_str(&event);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::model::CaptionWord;
    use super::*;

    fn word(text: &str, start: f64, end: f64) -> CaptionWord {
        CaptionWord { text: text.into(), start, end }
    }

    fn look(preset: Preset) -> Look {
        Look { preset, font: "Noto Sans".into(), font_size: 64.0, primary: "#FFFFFF".into(), highlight: "#FFD400".into(), outline: 4.0, shadow: 0.0, position: Position::Bottom, uppercase: false, bold: true, margin_v: 120, margin_h: 60 }
    }

    fn request(preset: Preset, lines: Vec<CaptionLine>) -> AssRequest {
        AssRequest { width: 1080, height: 1920, look: look(preset), lines }
    }

    fn line(words: Vec<CaptionWord>, break_at: Option<usize>) -> CaptionLine {
        CaptionLine { start: words[0].start, end: words[words.len() - 1].end, words, break_at }
    }

    fn dialogues(ass: &str) -> Vec<&str> {
        ass.lines().filter(|l| l.starts_with("Dialogue:")).collect()
    }

    #[test]
    fn header_has_the_video_size_and_one_style() {
        let ass = build_ass(&request(Preset::Clean, vec![line(vec![word("Hi", 0.0, 0.5)], None)]));
        assert!(ass.contains("PlayResX: 1080") && ass.contains("PlayResY: 1920"));
        assert_eq!(ass.lines().filter(|l| l.starts_with("Style:")).count(), 1);
        assert!(ass.contains("Style: Default,Noto Sans,64,&H00FFFFFF"));
        assert!(ass.contains(",2,60,60,120,1")); // bottom centre, margins
    }

    #[test]
    fn clean_puts_two_lines_with_a_break() {
        let l = line(vec![word("One", 0.0, 0.4), word("two", 0.4, 0.8), word("three", 0.8, 1.2)], Some(2));
        let ass = build_ass(&request(Preset::Clean, vec![l]));
        assert_eq!(dialogues(&ass), vec!["Dialogue: 0,0:00:00.00,0:00:01.20,Default,,0,0,0,,One two\\Nthree"]);
    }

    #[test]
    fn highlight_durations_follow_the_words_and_fill_the_line() {
        let l = line(vec![word("A", 0.0, 0.3), word("b", 0.5, 0.9), word("c", 1.0, 1.5)], None);
        let ass = build_ass(&request(Preset::Highlight, vec![l]));
        let text = dialogues(&ass)[0].rsplit(",,").next().unwrap().to_string();
        assert_eq!(text, "{\\k50}A {\\k50}b {\\k50}c");
        // The spoken color is the highlight; the unspoken one is the normal color.
        assert!(ass.contains("Style: Default,Noto Sans,64,&H0000D4FF,&H00FFFFFF"));
    }

    #[test]
    fn highlight_waits_for_a_late_first_word() {
        let mut l = line(vec![word("Hi", 0.4, 0.8)], None);
        l.start = 0.2;
        let ass = build_ass(&request(Preset::Highlight, vec![l]));
        assert!(dialogues(&ass)[0].ends_with("{\\k20}{\\k40}Hi"));
    }

    #[test]
    fn korean_and_japanese_text_is_kept_exactly() {
        let ko = line(vec![word("안녕하세요", 0.0, 0.6), word("여러분", 0.6, 1.2)], None);
        let ja = line(vec![word("今", 2.0, 2.2), word("日", 2.2, 2.4), word("は", 2.4, 2.6)], None);
        let ass = build_ass(&request(Preset::Clean, vec![ko, ja]));
        assert!(ass.contains(",,안녕하세요 여러분\n"));
        assert!(ass.contains(",,今日は\n"));
    }

    #[test]
    fn pop_shows_two_words_at_a_time_with_a_scale_in() {
        let l = line(vec![word("a", 0.0, 0.2), word("b", 0.2, 0.4), word("c", 0.4, 0.6)], None);
        let ass = build_ass(&request(Preset::Pop, vec![l]));
        let d = dialogues(&ass);
        assert_eq!(d.len(), 2);
        assert!(d[0].contains("0:00:00.00,0:00:00.40") && d[0].ends_with("\\fscy100)}a b"));
        assert!(d[1].contains("0:00:00.40,0:00:00.60") && d[1].ends_with("c"));
    }

    #[test]
    fn boxed_uses_an_opaque_box_style() {
        let ass = build_ass(&request(Preset::Boxed, vec![line(vec![word("x", 0.0, 1.0)], None)]));
        let style = ass.lines().find(|l| l.starts_with("Style:")).unwrap();
        assert!(style.contains(",3,")); // BorderStyle 3
        assert!(style.contains("&H55000000")); // the box is see-through
    }

    #[test]
    fn documentary_is_a_lower_third_on_the_left() {
        let ass = build_ass(&request(Preset::Documentary, vec![line(vec![word("x", 0.0, 1.0)], None)]));
        assert!(ass.lines().find(|l| l.starts_with("Style:")).unwrap().contains(",1,60,60,120,1"));
    }

    #[test]
    fn positions_and_uppercase_and_escaping() {
        let mut req = request(Preset::Clean, vec![line(vec![word("hi {x}", 0.0, 1.0)], None)]);
        req.look.position = Position::Top;
        req.look.uppercase = true;
        let ass = build_ass(&req);
        assert!(ass.contains(",8,60,60,120,1"));
        assert!(ass.contains(",,HI \\{X\\}\n"));
    }

    #[test]
    fn none_has_no_events_and_empty_lines_are_skipped() {
        let ass = build_ass(&request(Preset::None, vec![line(vec![word("x", 0.0, 1.0)], None)]));
        assert!(dialogues(&ass).is_empty());
        let mut empty = line(vec![word("x", 1.0, 1.0)], None);
        empty.end = empty.start;
        assert!(dialogues(&build_ass(&request(Preset::Clean, vec![empty]))).is_empty());
    }

    #[test]
    fn request_reads_the_json_the_app_sends() {
        let json = r##"{"width":1920,"height":1080,"look":{"preset":"highlight","font":"Noto Sans KR","fontSize":54,"primary":"#ffffff","highlight":"#ffd400","outline":3,"shadow":1,"position":"middle","uppercase":false,"bold":true,"marginV":90,"marginH":80},"lines":[{"start":0,"end":1,"words":[{"text":"안녕","start":0,"end":1}],"breakAt":null}]}"##;
        let req: AssRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.look.preset, Preset::Highlight);
        assert!(build_ass(&req).contains("Noto Sans KR"));
    }
}
