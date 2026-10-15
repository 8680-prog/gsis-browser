import { promises as dns, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';

/**
 * Network guards that stop the inspector from being used to reach private,
 * loopback, link-local or cloud-metadata addresses (SSRF protection).
 */

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

export class BlockedTargetError extends Error {
  readonly code = 'EBLOCKED';
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

export const systemResolver: Resolver = (hostname) =>
  dns.lookup(hostname, { all: true, verbatim: true });

/**
 * Builds a `lookup` function for http(s).request that resolves the hostname
 * once, refuses the connection if any resolved address is not allowed, and
 * hands only validated addresses to the socket. Because the socket connects to
 * exactly the addresses checked here, DNS rebinding between check and connect
 * is not possible.
 */
export function createGuardedLookup(
  resolver: Resolver,
  isAddressAllowed: (ip: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname)
      .then((addresses) => {
        if (addresses.length === 0) {
          const err = Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' });
          throw err;
        }
        const blocked = addresses.find((a) => !isAddressAllowed(a.address));
        if (blocked) {
          throw new BlockedTargetError(`${hostname} resolves to a non-public address`);
        }
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
        if (usable.length === 0) {
          throw Object.assign(new Error(`No IPv${wanted} address for ${hostname}`), { code: 'ENOTFOUND' });
        }
        if (options.all) {
          callback(null, usable);
        } else {
          callback(null, usable[0].address, usable[0].family);
        }
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, '', 0));
  };
}
