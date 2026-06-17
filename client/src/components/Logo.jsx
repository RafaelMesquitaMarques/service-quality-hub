// CheckMate brand logo, drawn inline as SVG so it scales crisply and adapts
// to its background. The check-mark and the word "Mate" are always green;
// "Check" and the tagline use `currentColor`, so control them by setting
// `color` on the element (e.g. white on the dark sidebar, dark navy on the
// light login card). Tweak GREEN here if the brand green needs adjusting.
const GREEN = '#16A34A'
const FONT  = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif'

export default function Logo({ withTagline = false, className, style, title = 'CheckMate' }) {
  if (withTagline) {
    return (
      <svg className={className} style={style} viewBox="0 0 720 280"
        role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
        <title>{title}</title>
        <path d="M55 170 L100 220 L205 58" fill="none" stroke={GREEN} strokeWidth="42"
          strokeLinecap="round" strokeLinejoin="round" />
        <text x="252" y="152" fontFamily={FONT} fontSize="112" fontWeight="800"
          letterSpacing="-2" textLength="438" lengthAdjust="spacingAndGlyphs">
          <tspan fill="currentColor">Check</tspan><tspan fill={GREEN}> Mate</tspan>
        </text>
        <text x="254" y="206" fontFamily={FONT} fontSize="26.5" fontWeight="700"
          letterSpacing="4" fill="currentColor" textLength="432" lengthAdjust="spacingAndGlyphs">
          QUALITY ISSUES<tspan fill={GREEN}>.</tspan> RESOLVED<tspan fill={GREEN}>.</tspan>
        </text>
      </svg>
    )
  }
  return (
    <svg className={className} style={style} viewBox="0 0 600 175"
      role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <path d="M42 100 L75 133 L155 30" fill="none" stroke={GREEN} strokeWidth="32"
        strokeLinecap="round" strokeLinejoin="round" />
      <text x="195" y="118" fontFamily={FONT} fontSize="100" fontWeight="800"
        letterSpacing="-2" textLength="390" lengthAdjust="spacingAndGlyphs">
        <tspan fill="currentColor">Check</tspan><tspan fill={GREEN}> Mate</tspan>
      </text>
    </svg>
  )
}
