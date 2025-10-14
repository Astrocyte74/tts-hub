/* Lightweight inline SVG icon set for consistent engine visuals.
   Icons are sized to 20x20 by default and inherit currentColor. */

import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

export function IconKokoro({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden {...props}>
      <path d="M12 21s-6.5-3.8-9-7.3C1.9 12.3 2 9.5 4 8c1.8-1.3 4.1-.7 5.3.8L12 11l2.7-2.2C15.9 7.3 18.2 6.7 20 8c2 1.5 2.1 4.3 1 5.7C18.5 17.2 12 21 12 21z" fill="currentColor"/>
    </svg>
  );
}

export function IconOpenVoice({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M8 21h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function IconChatTTS({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden {...props}>
      <path d="M4 4h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H10l-4 4v-4H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="8" cy="9" r="1" fill="currentColor"/>
      <circle cx="12" cy="9" r="1" fill="currentColor"/>
      <circle cx="16" cy="9" r="1" fill="currentColor"/>
    </svg>
  );
}

export function IconXTTS({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden {...props}>
      <rect x="3" y="4" width="18" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="3" y="14" width="18" height="6" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 8h2M10 8h4M6 17h2M10 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

