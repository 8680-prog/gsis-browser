import ipaddr from 'ipaddr.js';

/**
 * Runtime-independent address rules shared by the Node and Cloudflare
 * inspectors: refuse private, loopback, link-local, cloud-metadata and other
 * non-public targets (SSRF protection).
 */

export interface AddressPolicy {
  isAddressAllowed: (ip: string) => boolean;
  isHostnameAllowed: (hostname: string) => boolean;
  allowedPorts: number[];
}

/** True when `host` is an IP literal (WHATWG URL already normalised odd IPv4 forms). */
export function isIpLiteral(host: string): boolean {
  return ipaddr.IPv4.isValidFourPartDecimal(host) || ipaddr.IPv6.isValid(host);
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  // Everything ipaddr.js classifies as special (private, loopback, linkLocal,
  // carrierGradeNat, uniqueLocal, multicast, reserved, 6to4, teredo, NAT64,
  // ...) is rejected. 169.254.169.254 and fd00:ec2::254 fall in those ranges.
  return addr.range() === 'unicast';
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.test', '.invalid'];

/** Rejects names that can only refer to local or internal infrastructure. */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost') return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  // Single-label names ("intranet", "router") resolve via local search domains.
  if (!host.includes('.') && !ipaddr.isValid(host)) return false;
  return true;
}
