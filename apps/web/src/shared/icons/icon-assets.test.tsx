import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ICON_SVG } from './icon-assets.js';
import { SvgIcon } from './SvgIcon.js';

describe('web icon assets', () => {
  it('loads each standalone SVG as valid markup', () => {
    const parser = new DOMParser();
    for (const svg of Object.values(ICON_SVG)) {
      const document = parser.parseFromString(svg, 'image/svg+xml');
      expect(document.documentElement.localName).toBe('svg');
      expect(document.querySelector('parsererror')).toBeNull();
    }
  });

  it('renders an asset as an accessible decorative icon', () => {
    render(
      <button type="button">
        <SvgIcon name="close" />
      </button>,
    );

    expect(screen.getByRole('button').querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button').querySelector('span')).toHaveAttribute('aria-hidden', 'true');
  });
});
