package main

import (
	"fmt"
	"os"

	"example.com/kv"
)

func main() {
	store := kv.New()
	if err := run(store, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(store *kv.Store, args []string) error {
	key := kv.Join("cli", args[0])
	if len(args) > 1 {
		return store.Set(key, args[1])
	}
	value, err := store.Get(key)
	if err != nil {
		return err
	}
	fmt.Println(value)
	return nil
}
