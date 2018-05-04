default:
	cat Makefile

setup:
	yarn

merge:
	git remote add upstream https://github.com/prebid/Prebid.js.git
	git fetch upstream
	git merge d06b5abc41069258b46ad9c16d4d9a4ef75554bf

.PHONY: build
build:
	./node_modules/.bin/gulp build --modules=prebid_modules.json
