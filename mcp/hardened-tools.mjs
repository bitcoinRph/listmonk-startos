const SCHEDULING_FIELDS = Object.freeze(['send_later', 'send_at'])

function withoutSchedulingFields(inputSchema) {
  const safeSchema = { ...inputSchema }
  for (const field of SCHEDULING_FIELDS) delete safeSchema[field]
  return safeSchema
}

function rejectSchedulingFields(args) {
  if (SCHEDULING_FIELDS.some((field) => Object.hasOwn(args, field))) {
    throw new Error('Campaign scheduling fields are disabled on this MCP server')
  }
}

export function buildHardenedTools(allTools) {
  return allTools
    .filter((tool) => tool.name !== 'listmonk_update_campaign')
    .map((tool) => {
      if (tool.name !== 'listmonk_create_campaign') return tool

      return {
        ...tool,
        description:
          'Creates a new campaign as a draft. Scheduling fields are disabled on this server.',
        inputSchema: withoutSchedulingFields(tool.inputSchema),
        handler: async (client, args) => {
          rejectSchedulingFields(args)
          return tool.handler(client, args)
        },
      }
    })
}
