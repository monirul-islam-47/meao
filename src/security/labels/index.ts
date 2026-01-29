export type {
  TrustLevel,
  DataClass,
  ContentLabel,
  FlowDecision,
  ToolCapabilityLabels,
} from './types.js'

export { TRUST_ORDER, DATA_CLASS_ORDER } from './types.js'

export {
  combineLabels,
  propagateLabel,
  minTrust,
  maxSensitivity,
  meetsTrustRequirement,
  withinDataClass,
} from './propagation.js'

export {
  labelOutput,
  labelUserInput,
  labelWebFetch,
  labelFileRead,
  labelSystem,
} from './output.js'
