const fs = require('node:fs');
const path = require('node:path');
const prettier = require('prettier');
const {getDebug, parseFiles, buildLocalFilename} = require('../utils')
const {getDefaultOptions, parseI18nConfig} = require('../options')
const {processAST, generateCode} = require('./ast')
const {translate, updateLocale} = require('./translate')
const {initGlossaries} = require('./glossary');
const debug = getDebug('scan');

async function scan(cmdOptions) {
    debug('execute scan method', cmdOptions);
    let options = getDefaultOptions();
    if (!cmdOptions.config) {
        debug('config option is empty, skip process of parseI18nConfig');
    } else {
        options = await parseI18nConfig(cmdOptions.config);
    }
    debug('final i18n config is %O', options);

    // expand scan files
    let targetFiles = [];
    if (cmdOptions.file) {
        targetFiles = [
            {
                filePath: cmdOptions.file,
                ext: path.extname(cmdOptions.file),
            },
        ];
        debug(
            'expand entry in single file mode, expand files are: %O',
            targetFiles,
        );
    } else if (cmdOptions.directory) {
        targetFiles = parseFiles({
            ...options,
            entry: [cmdOptions.directory],
        });
        debug(
            'expand entry in directory mode, expand files are: %O',
            targetFiles,
        );
    } else {
        targetFiles = parseFiles(options);
        debug(
            'expand entry in config mode, expand files are: %O',
            targetFiles,
        );
    }
    let needUpdateLocale = true
    if (cmdOptions.file || cmdOptions.directory) {
        needUpdateLocale = false
    }

    const cnLocalePath = buildLocalFilename(options.localesDir, options.originLang)

    const prettierConfig = await prettier.resolveConfig(path.join(process.cwd(), '.prettierrc'));

    let updatedData = {};
    for (const file of targetFiles) {
        debug('Processing single file: %s', file.filePath);
        const tsxCode = fs.readFileSync(file.filePath, 'utf8');
        const {ast, CNPath, i18nMap, i18nImported} = processAST(tsxCode, false);
        if (CNPath.length > 0) {
            const transformedCode = generateCode(ast, i18nImported, CNPath);
            const formattedCode = await prettier.format(transformedCode, {
                ...prettierConfig,
                parser: 'typescript',
            });

            fs.writeFileSync(file.filePath, formattedCode, 'utf8');
            updatedData = {
                ...updatedData,
                ...i18nMap,
            }
        }
    }

    // intercept updatedData
    // for scenario of glossary, the i18n-tool should use translation in glossary first
    const glossaryFilePath = path.join(options.localesDir, `glossaries.csv`)
    debug("glossaryFilePath is %s", glossaryFilePath)
    const glossaryData = initGlossaries(glossaryFilePath)
    debug('glossaryData is %O', glossaryData);
    /*
    {
        "zh-CN": {
            updatedData but remove zh-CN column glossaries
        },
        "en-US": {
            updatedData but remove en-US column glossaries
        }
    }
    */
    const groupedGlossaryData = {}
    for (const key of Object.keys(glossaryData)) {
        const tmp = glossaryData[key];
        for (const lang of Object.keys(tmp)) {
            groupedGlossaryData[lang] = groupedGlossaryData[lang] || {}
            groupedGlossaryData[lang][key] = tmp[lang]
        }
    }
    debug('groupedGlossaryData is %O', groupedGlossaryData);
    /*
    const updatedDataWithoutGlossaryByLang = options.targetLangs
        .map(targetLang => {
            const updatedDataWithoutGlossary = Object.keys(updatedData)
                .reduce((p, c) => {
                    const key = c
                    if (key in glossaryData && glossaryData[key][targetLang]) {
                        return p
                    }
                    p[key] = updatedData[key]
                    return p
                }, {})
            return {
                lang: targetLang,
                updatedDataWithoutGlossary
            }
        })
        .reduce((p, c) => {
            const {lang, updatedDataWithoutGlossary} = c;
            return {
                ...p,
                [lang]: updatedDataWithoutGlossary
            }
        }, {})

    debug('updatedDataWithoutGlossaryByLang is %O', updatedDataWithoutGlossaryByLang)
    debug('updatedData is %O', updatedData)
    */
    if (needUpdateLocale) {
        // const tmpData = groupedGlossaryData['zh-CN'] || updatedData
        // fs.writeFileSync(cnLocalePath, JSON.stringify({
        //     ...existingData,
        //     ...tmpData,
        // }))
        updateLocale(cnLocalePath, updatedData, groupedGlossaryData['zh-CN'])
    }

    if (needUpdateLocale) {
        for (const targetLang of options.targetLangs) {
            const targetLocalePath = buildLocalFilename(options.localesDir, targetLang)
            const targetLangLocale = await translate(updatedData, {
                appid: options.translate.appid,
                key: options.translate.key,
                type: options.translate.type,
                model: options.translate.model,
                from: options.originLang,
                to: targetLang
            })
            updateLocale(targetLocalePath, targetLangLocale, groupedGlossaryData[targetLang])
        }
    }

}

module.exports = scan
