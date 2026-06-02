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
];

export function getRequestTemplateById(templateId: string) {
  return REQUEST_TEMPLATES.find((template) => template.id === templateId) ?? null;
}
