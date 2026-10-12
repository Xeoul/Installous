"use client";

/**
 * Robinhood-style rolling digits: every digit is a vertical strip of 0-9 that
 * slides to its new value, so prices tick instead of blinking. Characters are
 * keyed from the right so $99.99 → $100.01 rolls the existing columns rather
 * than shifting them. Honors prefers-reduced-motion (see globals.css).
 */
export function RollingNumber({ value, className = "" }: { value: string; className?: string }) {
  const chars = [...value];
  return (
    <span className={`rolling-number ${className}`} aria-label={value} role="text">
      {chars.map((ch, i) => {
        const key = chars.length - i; // position from the right
        if (ch >= "0" && ch <= "9") {
          const d = ch.charCodeAt(0) - 48;
          return (
            <span key={key} className="rolling-digit" aria-hidden>
              <span className="rolling-strip" style={{ transform: `translateY(-${d * 10}%)` }}>
                0<br />1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9
              </span>
              {/* Invisible copy keeps the column exactly one digit wide and tall. */}
              <span className="rolling-sizer">{ch}</span>
            </span>
          );
        }
        return (
          <span key={key} aria-hidden>
            {ch}
          </span>
        );
      })}
    </span>
  );
}
