import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarRail } from '../../components/layout/SidebarRail';

describe('SidebarRail collapse/expand visibility', () => {
  it('re-expands collapsed rail from app logo without extra toggle icon strip', () => {
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

    expect(html).toContain('aria-label="Expand Sidebar Rail"');
    expect(html).toContain('title="Expand Sidebar Rail"');
    expect(html).toContain('justify-center px-2');
    expect(html).not.toContain('lucide-panel-left-open');
    expect(html).not.toContain('aria-label="Collapse Sidebar to Icons"');
  });

  it('renders Collapse Sidebar button inside h-14 header when expanded', () => {
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

    expect(html).toContain('aria-label="Collapse Sidebar to Icons"');
    expect(html).not.toContain('aria-label="Expand Sidebar Rail"');
  });
});
