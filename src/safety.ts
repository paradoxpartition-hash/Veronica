export type SafetyLevel = 'SAFE_AUTO' | 'REQUIRES_APPROVAL' | 'FORBIDDEN';

const SAFE_AUTO = new Set([
  'read_logs',
  'check_health',
  'check_disk',
  'docker_status',
  'restart_prometheus',
  'restart_grafana',
  'restart_node_exporter',
  'restart_cadvisor',
  'restart_alertmanager',
]);

const REQUIRES_APPROVAL = new Set([
  'restart_mailcow',
  'restart_nginx',
  'restart_nginx_proxy_manager',
  'restart_portainer',
  'restart_saasolution',
  'restart_container',
  'edit_config',
  'update_container',
  'change_firewall',
  'reboot_vps',
  'git_pull',
  'deploy',
]);

const FORBIDDEN = new Set([
  'delete_database',
  'expose_secrets',
  'disable_firewall',
  'remove_volume',
  'wipe_container',
  'drop_table',
  'delete_mailbox',
  'change_dns',
]);

export function classifyAction(action: string): SafetyLevel {
  if (FORBIDDEN.has(action)) return 'FORBIDDEN';
  if (SAFE_AUTO.has(action)) return 'SAFE_AUTO';
  if (REQUIRES_APPROVAL.has(action)) return 'REQUIRES_APPROVAL';
  return 'REQUIRES_APPROVAL';
}

export function isMonitoringContainer(name: string): boolean {
  const monitoring = ['prometheus', 'grafana', 'node-exporter', 'cadvisor', 'alertmanager'];
  return monitoring.some(m => name.toLowerCase().includes(m));
}
