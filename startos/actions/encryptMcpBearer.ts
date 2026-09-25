import { constants, createPublicKey, publicEncrypt } from 'node:crypto'

export function encryptMcpBearer(publicKeyPem: string, bearer: string): string {
  if (!bearer) throw new Error('MCP bearer must not be empty')
  const key = createPublicKey(publicKeyPem)
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error('Handoff public key must be RSA')
  }
  const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0
  if (modulusLength < 2048) {
    throw new Error('Handoff RSA key must be at least 2048 bits')
  }
  return publicEncrypt(
    {
      key,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(bearer, 'utf8'),
  ).toString('base64')
}
