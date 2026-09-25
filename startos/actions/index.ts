import { sdk } from '../sdk'
import { finalizeMcpBearerRotation } from './finalizeMcpBearerRotation'
import { exportMcpBearerHandoff } from './exportMcpBearerHandoff'
import { rollbackMcpBearer } from './rollbackMcpBearer'
import { rotateMcpBearer } from './rotateMcpBearer'

export const actions = sdk.Actions.of()
  .addAction(rotateMcpBearer)
  .addAction(rollbackMcpBearer)
  .addAction(finalizeMcpBearerRotation)
  .addAction(exportMcpBearerHandoff)
