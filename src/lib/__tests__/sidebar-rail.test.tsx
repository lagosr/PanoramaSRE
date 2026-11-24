import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarRail } from '../../components/layout/SidebarRail';

describe('SidebarRail collapse/expand visibility', () => {
  it('renders dedicated centered Expand button strip below h-14 header when collapsed', () => {
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
    expect(html).toContain('aria-label="Expand Sidebar Rail from Logo"');
    expect(html).toContain('justify-center px-2');
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
