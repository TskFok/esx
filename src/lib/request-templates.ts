export type RequestTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
};

export const REQUEST_TEMPLATES: RequestTemplate[] = [
  {
    id: "cluster-health",
    name: "集群健康",
    description: "查看集群 green / yellow / red 状态",
    content: "GET /_cluster/health",
    tags: ["巡检"],
  },
  {
    id: "cluster-stats",
    name: "集群统计",
    description: "查看节点、索引与分片汇总信息",
    content: "GET /_cluster/stats",
    tags: ["巡检"],
  },
  {
    id: "cat-indices",
    name: "索引列表",
    description: "以表格形式列出索引及文档量",
    content: "GET /_cat/indices?v",
    tags: ["巡检"],
  },
  {
    id: "cat-nodes",
    name: "节点列表",
    description: "查看节点角色、堆内存与负载",
    content: "GET /_cat/nodes?v",
    tags: ["巡检"],
  },
  {
    id: "match-all-search",
    name: "全量查询",
    description: "对指定索引执行 match_all 查询",
    content: 'POST /my-index/_search\n{\n  "query": {\n    "match_all": {}\n  },\n  "size": 10\n}',
    tags: ["查询"],
  },
  {
    id: "index-mapping",
    name: "索引 Mapping",
    description: "查看索引字段 mapping 结构",
    content: "GET /my-index/_mapping",
    tags: ["索引"],
  },
  {
    id: "index-settings",
    name: "索引 Settings",
    description: "查看索引分片、副本等配置",
    content: "GET /my-index/_settings",
    tags: ["索引"],
  },
  {
    id: "alias-list",
    name: "Alias 列表",
    description: "查看当前集群 alias 绑定关系",
    content: "GET /_cat/aliases?v",
    tags: ["索引"],
  },
  {
    id: "allocation-explain",
    name: "分片分配解释",
    description: "定位 unassigned shard 或分片无法分配原因",
    content: "GET /_cluster/allocation/explain",
    tags: ["诊断"],
  },
  {
    id: "pending-tasks",
    name: "等待任务",
    description: "查看 master 节点积压的集群任务",
    content: "GET /_cluster/pending_tasks",
    tags: ["诊断"],
  },
  {
    id: "cat-recovery",
    name: "恢复进度",
    description: "查看 shard recovery 状态",
    content: "GET /_cat/recovery?v&bytes=b",
    tags: ["诊断"],
  },
  {
    id: "cat-allocation",
    name: "分配概览",
    description: "查看每个节点的分片和磁盘分配情况",
    content: "GET /_cat/allocation?v&bytes=b",
    tags: ["诊断"],
  },
  {
    id: "hot-threads",
    name: "热点线程",
    description: "查看节点热点线程，定位 CPU 压力",
    content: "GET /_nodes/hot_threads",
    tags: ["诊断"],
  },
  {
    id: "tasks-list",
    name: "任务列表",
    description: "查看当前运行中的任务",
    content: "GET /_tasks?detailed=true&actions=*",
    tags: ["诊断"],
  },
  {
    id: "bulk-index",
    name: "Bulk 写入",
    description: "使用 NDJSON 批量写入文档",
    content: 'POST /my-index/_bulk\n{"index":{"_id":"1"}}\n{"message":"hello"}',
    tags: ["写入"],
  },
  {
    id: "msearch",
    name: "Multi Search",
    description: "使用 NDJSON 执行多搜索",
    content: 'POST /_msearch\n{"index":"my-index"}\n{"query":{"match_all":{}},"size":10}',
    tags: ["查询"],
  },
  {
    id: "profile-search",
    name: "Profile 查询",
    description: "开启 profile 分析查询性能",
    content: 'POST /my-index/_search\n{\n  "profile": true,\n  "query": {\n    "match_all": {}\n  },\n  "size": 10\n}',
    tags: ["诊断", "查询"],
  },
  {
    id: "validate-query",
    name: "校验查询",
    description: "校验查询 DSL 并返回解释",
    content: 'POST /my-index/_validate/query?explain=true\n{\n  "query": {\n    "match_all": {}\n  }\n}',
    tags: ["诊断", "查询"],
  },
];

export function getRequestTemplateById(templateId: string) {
  return REQUEST_TEMPLATES.find((template) => template.id === templateId) ?? null;
}
