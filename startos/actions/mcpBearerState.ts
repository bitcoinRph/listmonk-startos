export type McpBearerState = {
  listmonkToken?: string
  serverAuthToken?: string
  previousServerAuthToken?: string
}

type CompleteMcpBearerState = {
  listmonkToken: string
  serverAuthToken: string
  previousServerAuthToken?: string
}

function requireComplete(state: McpBearerState): CompleteMcpBearerState {
  if (!state.listmonkToken || !state.serverAuthToken) {
    throw new Error('MCP credential store is incomplete')
  }
  return {
    listmonkToken: state.listmonkToken,
    serverAuthToken: state.serverAuthToken,
    previousServerAuthToken: state.previousServerAuthToken,
  }
}

export function rotateMcpBearerState(
  state: McpBearerState,
  newServerAuthToken: string,
): CompleteMcpBearerState {
  const current = requireComplete(state)
  if (current.previousServerAuthToken) {
    throw new Error('An MCP bearer rotation is already pending')
  }
  if (!newServerAuthToken) throw new Error('New MCP bearer must not be empty')
  return {
    listmonkToken: current.listmonkToken,
    serverAuthToken: newServerAuthToken,
    previousServerAuthToken: current.serverAuthToken,
  }
}

export function rollbackMcpBearerState(
  state: McpBearerState,
): CompleteMcpBearerState {
  const current = requireComplete(state)
  if (!current.previousServerAuthToken) {
    throw new Error('No MCP bearer rotation is pending')
  }
  return {
    listmonkToken: current.listmonkToken,
    serverAuthToken: current.previousServerAuthToken,
  }
}

export function finalizeMcpBearerState(
  state: McpBearerState,
): CompleteMcpBearerState {
  const current = requireComplete(state)
  if (!current.previousServerAuthToken) {
    throw new Error('No MCP bearer rotation is pending')
  }
  return {
    listmonkToken: current.listmonkToken,
    serverAuthToken: current.serverAuthToken,
  }
}

let stateQueue: Promise<void> = Promise.resolve()

export async function withMcpBearerStateLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = stateQueue
  let release!: () => void
  stateQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}
