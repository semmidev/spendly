package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
)

// AESEncryptor untuk refresh token Gmail (PLAN §2.2, envelope sederhana).
// ponytail: KMS/Vault menyusul; API Encrypt/Decrypt stabil sehingga ganti mudah.
type AESEncryptor struct{ key []byte }

func NewAESEncryptor(keyStr string) (*AESEncryptor, error) {
	k := []byte(keyStr)
	if len(k) != 16 && len(k) != 24 && len(k) != 32 {
		return nil, errors.New("key length must be 16, 24, or 32 bytes")
	}
	return &AESEncryptor{key: k}, nil
}

func (e *AESEncryptor) Encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plaintext), nil)), nil
}

func (e *AESEncryptor) Decrypt(cryptoText string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(cryptoText)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	ns := gcm.NonceSize()
	if len(raw) < ns {
		return "", errors.New("ciphertext too short")
	}
	pt, err := gcm.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
