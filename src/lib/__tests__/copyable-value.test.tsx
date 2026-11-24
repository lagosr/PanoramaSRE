import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CopyableAddressText,
  CopyableValue,
  tokenizeAddresses,
} from '../../components/ui/CopyableValue';

describe('CopyableValue address tokenization and rendering', () => {
  it('detects MAC, IPv4, IPv4:port, CIDR, and IPv6 addresses while ignoring timestamps', () => {
    const macTokens = tokenizeAddresses(
      'Previously unseen MAC C4:EF:3D:56:9C:07 obtained IP 172.16.1.37 at 08:17:10.'
    );
    const copyables = macTokens.filter((t) => t.copyable);
    expect(copyables).toEqual([
      { text: 'C4:EF:3D:56:9C:07', copyable: true, kind: 'mac' },
      { text: '172.16.1.37', copyable: true, kind: 'ipv4' },
    ]);

    const mixedTokens = tokenizeAddresses(
      'Allow 100.64.251.0/24 -> 172.25.25.5:5514 and 2a06:98c0:3600::103 or fe80::1/64 (v1.10.5)'
    ).filter((t) => t.copyable);
    expect(mixedTokens).toEqual([
      { text: '100.64.251.0/24', copyable: true, kind: 'ipv4' },
      { text: '172.25.25.5:5514', copyable: true, kind: 'ipv4' },
      { text: '2a06:98c0:3600::103', copyable: true, kind: 'ipv6' },
      { text: 'fe80::1/64', copyable: true, kind: 'ipv6' },
    ]);
  });

  it('renders plain spans for placeholders and interactive copy buttons for valid addresses', () => {
    const emptyMarkup = renderToStaticMarkup(<CopyableValue value={null} fallback="no-ip" />);
    expect(emptyMarkup).toBe('<span>no-ip</span>');

    const ipMarkup = renderToStaticMarkup(
      <CopyableValue value="10.10.1.2" label="Gateway IP" />
    );
    expect(ipMarkup).toContain('<button');
    expect(ipMarkup).toContain('Copy Gateway IP');
    expect(ipMarkup).toContain('10.10.1.2');

    const proseMarkup = renderToStaticMarkup(
      <CopyableAddressText text="Src: 10.10.1.2 -> 172.25.25.5" />
    );
    expect(proseMarkup).toContain('Copy IP / subnet');
  });
});
