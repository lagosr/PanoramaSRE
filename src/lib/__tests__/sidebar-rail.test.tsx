import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarRail } from '../../components/layout/SidebarRail';

describe('SidebarRail collapse/expand visibility', () => {
  it('renders floating circular chevron-right edge toggle when collapsed without clipping outer aside', () => {
    const html = renderToStaticMarkup(
      <SidebarRail
        activeTab="hud"
        onSelectTab={vi.fn()}
        unhealthyCount={0}
        isCollapsed={true}
        onToggleCollapse={vi.fn()}
        isInitialSyncComplete={true}
      />
    );

    const asideClassMatch = html.match(/<aside\b[^>]*class="([^"]+)"/);
    expect(asideClassMatch).not.toBeNull();
    expect(asideClassMatch?.[1]).toContain('relative');
    expect(asideClassMatch?.[1]).not.toContain('overflow-hidden');

    expect(html).toContain('aria-label="Expand Sidebar"');
    expect(html).toContain('title="Expand Sidebar"');
    expect(html).toContain('lucide-chevron-right');
    expect(html).toContain('-right-3.5');
    expect(html).toContain('rounded-full');
    expect(html).toContain('justify-center px-2');
    expect(html).not.toContain('lucide-panel-left-close');
    expect(html).not.toContain('lucide-panel-left-open');
    expect(html).not.toContain('aria-label="Collapse Sidebar"');
  });

  it('renders floating circular chevron-left edge toggle when expanded', () => {
    const html = renderToStaticMarkup(
      <SidebarRail
        activeTab="hud"
        onSelectTab={vi.fn()}
        unhealthyCount={0}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
        isInitialSyncComplete={true}
      />
    );

    expect(html).toContain('aria-label="Collapse Sidebar"');
    expect(html).toContain('title="Collapse Sidebar"');
    expect(html).toContain('lucide-chevron-left');
    expect(html).toContain('-right-3.5');
    expect(html).toContain('rounded-full');
    expect(html).not.toContain('aria-label="Expand Sidebar"');
    expect(html).not.toContain('lucide-panel-left-close');
  });
});
