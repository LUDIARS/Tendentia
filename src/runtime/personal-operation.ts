import type { ServiceOperationRisk } from '../../vendor/cernere-composite/dist/service-session.js';
const routes: Record<string, { method: string; path: string; risk: ServiceOperationRisk }> = {
  'tendentia.personal.session': { method: 'GET', path: '/api/session', risk: 'sensitive_read' },
  'tendentia.personal.access': { method: 'GET', path: '/api/trend-crawler/access', risk: 'sensitive_read' },
  'tendentia.personal.map': { method: 'GET', path: '/api/trend-crawler/map', risk: 'sensitive_read' },
  'tendentia.personal.tendency': { method: 'GET', path: '/api/trend-crawler/tendency', risk: 'sensitive_read' },
  'tendentia.personal.interest.read': { method: 'GET', path: '/api/trend-crawler/interest', risk: 'sensitive_read' },
  'tendentia.personal.interest.write': { method: 'PUT', path: '/api/trend-crawler/interest', risk: 'important' },
  'tendentia.personal.click': { method: 'POST', path: '/api/trend-crawler/click', risk: 'important' },
};
/** Destination-owned classification. @implements SPEC-TD-SCOPED-SESSION */
export function personalOperation(action: string, method: string, path: string): { risk: ServiceOperationRisk; resource: string } {
  const route = routes[action];
  if (!route || route.method !== method || route.path !== path) throw new Error('Unclassified personal operation');
  return { risk: route.risk, resource: `self:${route.path}` };
}
