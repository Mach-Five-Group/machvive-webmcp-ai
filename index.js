// Import all components to trigger their customElements.define() registration
import { MachviveLorumIpsum } from './src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js';
import {
  MachviveWebmcpPolyfill,
  installWebmcpPolyfill,
  TOOLS_CHANGED_EVENT
} from './src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';
import { MachviveWebmcpInspect } from './src/wc/machvive-webmcp-inspect/machvive-webmcp-inspect.js';
import { MachviveM5tMagnet } from './src/wc/machvive-m5t-magnet/machvive-m5t-magnet.js';
import {
  MachviveWebmcpAnalytics,
  CallLog,
  callLog,
  installAnalytics,
  CALL_EVENT
} from './src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js';

// Export them all from a single entry point
export {
  MachviveLorumIpsum,
  MachviveWebmcpPolyfill,
  MachviveWebmcpInspect,
  MachviveWebmcpAnalytics,
  MachviveM5tMagnet,
  CallLog,
  callLog,
  installWebmcpPolyfill,
  installAnalytics,
  TOOLS_CHANGED_EVENT,
  CALL_EVENT
};
