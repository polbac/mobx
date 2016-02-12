#!/usr/bin/env bash

# to be invoked from the root of mobservable, by using `npm run` to be able to resolve binaries

# This script takes all typescript files, concatenates it to one big file and removes import and export statements.
# This makes the library a factor 2 - 3 small, both minified and unminified, because
# 1) when having many source files, there are a lot of webpack require calls lingering around
# 2) when export functions from typescript files, they cannot be minified anymore because they are exported 
#    (or added as prop to a namespace if using namespace),
#    while actually they can be minified as long as they are internal to the module 

# prelude
set -e
rm -rf lib .build
mkdir -p .build

echo '/** Mobservable - (c) Michel Weststrate 2015, 2016 - MIT Licensed */' > .build/mobservable.ts

# generate exports config
cat src/mobservable.ts | grep -v 'import' | sed -e 's/from.*$//g' >> .build/mobservable.ts

# find all ts files, concat them (with newlines), remove all import statements, remove export keyword
ls src/{core,types,api,utils}/*.ts | xargs awk 'BEGINFILE {print "/* file:", FILENAME, "*/"} {print $0}' | grep -v 'import ' | sed -e 's/^export //g' >> .build/mobservable.ts

# compile, generate declaration, no comments
tsc -m umd -t es5 -d --removeComments --sourcemap --outDir lib .build/mobservable.ts 

# minify, mangle, compress, wrap in function
# N.B: don't worry about the dead code warnings, see https://github.com/Microsoft/TypeScript/issues/7017#issuecomment-182789529
uglifyjs -m sort,toplevel -c --screw-ie8 --preamble '/** Mobservable - (c) Michel Weststrate 2015, 2016 - MIT Licensed */' --in-source-map lib/mobservable.js.map --source-map lib/mobservable.min.js.map -o lib/mobservable.min.js lib/mobservable.js
