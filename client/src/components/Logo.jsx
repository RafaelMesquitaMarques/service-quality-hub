// CheckMate brand logo, drawn inline as SVG so it scales crisply and adapts
// to its background. "Check", the word "Mate" and the green check-mark are
// laid out so the check sits integrated over the "k" of Check. "Check" and
// the tagline use `currentColor` (set `color` per context — white on the
// green sidebar, dark on the light login card); "Mate", the check and the
// tagline dots are always green. Tweak GREEN / the check path if needed.
const GREEN = '#16A34A'
const FONT  = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif'

export default function Logo({ withTagline = false, className, style, title = 'CheckMate' }) {
  if (withTagline) {
    return (
      <svg className={className} style={style} viewBox="0 0 720 280"
        role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
        <title>{title}</title>
        {/* "Check" — right-anchored so the k always ends at x=398 */}
        <text textAnchor="end" x="398" y="152" fontFamily={FONT} fontSize="112" fontWeight="800"
          letterSpacing="-2" textLength="340" lengthAdjust="spacingAndGlyphs" fill="currentColor">Check</text>
        {/* green check integrated over the k */}
        <path d="M336 110 L358 134 L398 58" fill="none" stroke={GREEN} strokeWidth="24"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* "Mate" — left-anchored after the space */}
        <text textAnchor="start" x="431" y="152" fontFamily={FONT} fontSize="112" fontWeight="800"
          letterSpacing="-2" textLength="273" lengthAdjust="spacingAndGlyphs" fill={GREEN}>Mate</text>
        {/* tagline */}
        <text x="60" y="212" fontFamily={FONT} fontSize="23" fontWeight="700"
          letterSpacing="2" fill="currentColor" textLength="644" lengthAdjust="spacingAndGlyphs">
          VERIFY<tspan fill={GREEN}>.</tspan> ASSURE<tspan fill={GREEN}>.</tspan> SUPPORT<tspan fill={GREEN}>.</tspan> TOGETHER<tspan fill={GREEN}>.</tspan>
        </text>
      </svg>
    )
  }
  return (
    <svg className={className} style={style} viewBox="0 0 600 175"
      role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      {/* "Check" — right-anchored so the k always ends at x=334 */}
      <text textAnchor="end" x="334" y="118" fontFamily={FONT} fontSize="100" fontWeight="800"
        letterSpacing="-2" textLength="279" lengthAdjust="spacingAndGlyphs" fill="currentColor">Check</text>
      {/* green check integrated over the k */}
      <path d="M282 84 L300 104 L334 44" fill="none" stroke={GREEN} strokeWidth="21"
        strokeLinecap="round" strokeLinejoin="round" />
      {/* "Mate" — left-anchored after the space */}
      <text textAnchor="start" x="361" y="118" fontFamily={FONT} fontSize="100" fontWeight="800"
        letterSpacing="-2" textLength="224" lengthAdjust="spacingAndGlyphs" fill={GREEN}>Mate</text>
    </svg>
  )
}
