// Package kv is a tiny in-memory key-value store used as a parser fixture.
package kv

import (
	"errors"
	"fmt"
	str "strings"
)

const DefaultCapacity = 16

const (
	// MaxKeyLength is the longest key the store accepts.
	MaxKeyLength = 64
	separator    = ":"
)

var ErrNotFound = errors.New("kv: key not found")

type (
	// Key is a namespaced key.
	Key string

	// Entry is one stored value.
	Entry struct {
		Value string
		Hits  int
	}
)

// Reader is the read side of a store.
type Reader interface {
	Get(key Key) (string, error)
	Len() int
}

// Store keeps entries in memory.
type Store struct {
	entries map[Key]*Entry
}

// New returns an empty store.
func New() *Store {
	return &Store{entries: make(map[Key]*Entry, DefaultCapacity)}
}

// Get returns the value for key and counts the hit.
func (s *Store) Get(key Key) (string, error) {
	entry, ok := s.entries[normalize(key)]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrNotFound, key)
	}
	entry.Hits++
	return entry.Value, nil
}

// Set stores a value, replacing any previous one.
func (s *Store) Set(key Key, value string) error {
	if len(key) > MaxKeyLength {
		return errors.New("kv: key too long")
	}
	s.entries[normalize(key)] = &Entry{Value: value}
	return nil
}

// Len reports how many keys are stored.
func (s Store) Len() int {
	return len(s.entries)
}

// Join builds a namespaced key.
func Join(namespace, name string) Key {
	return normalize(Key(namespace + separator + name))
}

func normalize(key Key) Key {
	return Key(str.ToLower(str.TrimSpace(string(key))))
}
