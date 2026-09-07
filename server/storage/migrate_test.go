package storage

import (
	"testing"
	"testing/fstest"
)

func TestReadMigrations(t *testing.T) {
	migrations, err := readMigrations(fstest.MapFS{
		"10_second.sql": {Data: []byte("SELECT 2;")},
		"2_first.sql":   {Data: []byte("SELECT 1;")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if migrations[0].version != 2 || migrations[1].version != 10 {
		t.Fatal("migrations must sort numerically")
	}
	for name, source := range map[string]fstest.MapFS{
		"empty":    {},
		"filename": {"initial.sql": {Data: []byte("SELECT 1;")}},
		"zero":     {"0_initial.sql": {Data: []byte("SELECT 1;")}},
		"overflow": {"99999999999999999999_initial.sql": {Data: []byte("SELECT 1;")}},
		"blank":    {"1_initial.sql": {Data: []byte(" \n")}},
		"duplicate": {
			"01_first.sql": {Data: []byte("SELECT 1;")},
			"1_second.sql": {Data: []byte("SELECT 2;")},
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := readMigrations(source); err == nil {
				t.Fatal("accepted invalid migration source")
			}
		})
	}
}

func TestCheckHistory(t *testing.T) {
	first := migration{version: 1, name: "1_first.sql", checksum: "a"}
	second := migration{version: 2, name: "2_second.sql", checksum: "b"}
	if err := checkHistory([]migration{first, second}, []migration{first}); err != nil {
		t.Fatal(err)
	}
	for name, source := range map[string][]migration{
		"removed":   {},
		"reordered": {second, first},
		"renamed":   {{version: 1, name: "1_renamed.sql", checksum: "a"}},
		"edited":    {{version: 1, name: "1_first.sql", checksum: "changed"}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := checkHistory(source, []migration{first}); err == nil {
				t.Fatal("accepted changed migration history")
			}
		})
	}
}
