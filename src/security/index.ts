// Secrets
export {
  secretDetector,
  type Confidence,
  type SecretFinding,
  type SecretDetectionResult,
  type SecretSummary,
  type RedactOptions,
} from './secrets/index.js'

// Labels
export {
  type TrustLevel,
  type DataClass,
  type ContentLabel,
  type FlowDecision,
  type ToolCapabilityLabels,
  TRUST_ORDER,
  DATA_CLASS_ORDER,
  combineLabels,
  propagateLabel,
  minTrust,
  maxSensitivity,
  meetsTrustRequirement,
  withinDataClass,
  labelOutput,
  labelUserInput,
  labelWebFetch,
  labelFileRead,
  labelSystem,
} from './labels/index.js'

// Network
export {
  networkGuard,
  NetworkGuard,
  type NetworkCheckResult,
  type NetworkConfig,
  type AllowlistRule,
  DEFAULT_NETWORK_CONFIG,
} from './network/index.js'

// Flow control
export {
  canEgress,
  canWriteSemanticMemory,
  canWriteWorkingMemory,
  canChainTools,
} from './flow/index.js'
