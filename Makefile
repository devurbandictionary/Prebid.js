default:
	cat Makefile

setup:
	yarn

.PHONY: build
build:
	./node_modules/.bin/gulp build --modules=prebid_modules.json
