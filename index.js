// Import all components to trigger their customElements.define() registration
import { MachviveLorumIpsum } from './src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js';
import {
  MachviveWebmcpPolyfill,
  installWebmcpPolyfill,
  TOOLS_CHANGED_EVENT
} from './src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

// Export them all from a single entry point
export {
  MachviveLorumIpsum,
  MachviveWebmcpPolyfill,
  installWebmcpPolyfill,
  TOOLS_CHANGED_EVENT
};
