const net = require('net');
const { exec } = require('child_process');
const alea = require('./alea');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5555;
const DEFAULT_SEED = 'i_invested_way_too_much_time_into_this';
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_BYTES_PER_LINE = 10;

const HOST = process.env.HOST || DEFAULT_HOST;
const PORT = parseInt(process.env.PORT) || DEFAULT_PORT;
const SEED = process.env.SEED || DEFAULT_SEED;
const TIMEOUT = parseInt(process.env.TIMEOUT) || DEFAULT_TIMEOUT;
const BYTES_PER_LINE = parseInt(process.env.BYTES_PER_LINE) || DEFAULT_BYTES_PER_LINE;

const MAX_STRING_LEN = 33554432; // 32 * 2^20, src: https://moodle-app2.let.ethz.ch/mod/forum/discuss.php?d=91836#p200723

let rand = new alea(SEED);

/* =============== Helpers =============== */
const stbs = s => s.split('').map(c => c.charCodeAt(0));
const bsts = a => a.map(c => String.fromCharCode(c)).join('');
const stu8 = s => Uint8Array.from(stbs(s));
const u8ts = a => a !== undefined && a.length > 0 ? new TextDecoder().decode(a) : '';

const randInt = (base, len) => Math.floor(rand() * len) + base;
const randByte = () => randInt(0, 256);
const randAlphByte = () => randInt(97, 26);
const randString = (len, randFunc) => {
	const arr = [];
	for (let i = 0; i < len; i++) arr.push(randFunc());
	return arr;
};
const randByteString = len => randString(len, randByte);
const randAlphByteString = len => randString(len, randAlphByte);
const randAlphString = len => bsts(randString(len, randAlphByte));

const equal = (a, b) => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++)
		if (a[i] !== b[i])
			return false;
	return true;
}

const GET = stbs('GET');
const SET = stbs('SET');
const QUIT = stbs('GARBAGE_TO_CLOSE_CONNECTION');
const OK = stbs('OK');
const ERR = stbs('ERR');
const VALUE = stbs('VALUE');
const DOLLAR = '$'.charCodeAt(0);
const NEW_LINE = '\n'.charCodeAt(0);

const randCmd = (existingKeys, keyLength, valueLength, randFunc) => {
	const get = randInt(0, 2) === 0;
	const existingKey = existingKeys.length > 0 && randInt(0, 2) === 0;
	const cmd = {
		cmd: get ? 'GET' : 'SET',
		key: existingKey ? existingKeys[randInt(0, existingKeys.length)].split(',') : randFunc(keyLength)
	};
	if (!get) cmd.value = randFunc(valueLength);
	return cmd;
};

const randCmdList = (len, keyLength, valueLength, randFunc) => {
	const cmds = [];
	const state = {};
	for (let i = 0; i < len; i++) {
		const cmd = randCmd(state, keyLength, valueLength, randFunc);
		state[cmd.key] = true;
		cmds.push(cmd);
	}
	return cmds;
};

const encodeString = s => [
	DOLLAR,
	...(stbs(s.length + '')),
	DOLLAR,
	...s
];

const chunkify = (a, chunkSize) => {
	const chunks = [];
	for (let i = 0, j = a.length; i < j; i += chunkSize)
		chunks.push(a.slice(i, i + chunkSize));
	return chunks;
};

const colors = {
	reset: '\x1b[0m',
	red: '\x1b[31m',
	green: '\x1b[32m'
};

const printLine = c => console.log(c.repeat(process.stdout.columns / c.length));

const stripEdges = l => l.slice(1, l.length - 1);

/* ======================================= */
/* ============== Test shit ============== */

const generateInput = (test, varPrefix) => {
	const prefix = stbs(varPrefix + '_');
	return [].concat(...test.map(t => {
		if (t.raw) return t.raw;
		else if (t.cmd === 'GET') return [
			...GET,
			...encodeString([...prefix, ...t.key]),
			NEW_LINE
		];
		else if (t.cmd === 'SET') return [
			...SET,
			...encodeString([...prefix, ...t.key]),
			...encodeString(t.value),
			NEW_LINE
		];
		else throw Error(`Unknown command ${t.cmd}.`);
	}));
}

const generateOutput = test => test.reduce(({ state, output  }, t) => ({
	state: t.cmd === 'SET' ? { ...state, [t.key]: t.value } : state,
	output: [...output, ...(t.out !== undefined ? t.out : (
		t.cmd === 'SET' ? [...OK, NEW_LINE] :
		t.cmd === 'GET' && state[t.key] !== undefined ?
			[...VALUE, ...encodeString(state[t.key]), NEW_LINE]
		: [...ERR, NEW_LINE]
	))]
}), { state: {}, output: [] }).output;

const generateTestData = (name, cmdList) => {
	const input = Uint8Array.from([...generateInput(cmdList, name), ...QUIT, NEW_LINE]);
	const output = Uint8Array.from(generateOutput(cmdList));
	return { input, output };
};

const generatePrimitiveTest = (name, cmdList, alph) => {
	const data = generateTestData(name, cmdList);
	return {
		name,
		run: (si, om, pb) => runPrimitiveTest(data, si, om, pb, alph)
	};
};

const getOutput = data => new Promise((res, rej) => {
	let receivedData = [];

	const client = new net.Socket();
	const close = () => {
		client.destroy();
		res(receivedData);
	};
	client.connect(PORT, HOST);
	client.setTimeout(TIMEOUT, () => {
		client.destroy();
		rej({ code: 'TIMEOUT', receivedData });
	});

	client.on('ready', () => client.write(data.input));
	client.on('data', data => { receivedData = Uint8Array.from([...receivedData, ...data]) });
	client.on('end', close);
	client.on('close', close);
	client.on('error', error => {
		if (['EPIPE', 'ECONNRESET'].includes(error.code)) close();
		else rej({ code: error.code, receivedData });
	});
});

const execCommand = cmd => new Promise((res, rej) => {
	exec(cmd, undefined, (error, stdout, stderr) => {
		if (stderr)	rej(stderr);
		else		res(stdout);
	});
});

const prettyPrintString = s => `"${u8ts(s)}"`;
const prettyPrintBytes = a =>
	chunkify(
		[...a],
		BYTES_PER_LINE
	).map(l =>
		l.map(b => (b < 16 ? '0' : '') + Number(b).toString(16)).join(' ') +	// Bytes
		(' '.repeat(3 + 3 * (BYTES_PER_LINE - l.length))) +						// Space offset
		stripEdges(JSON.stringify(String.fromCharCode.apply(null, l)))			// Bytes as string
	).join('\n');

// outputMode: 0 = minimal, 1 = outputs, 2 = diff
const runPrimitiveTest = async (data, showInput, outputMode, printAsBytes, alph ) => {
	let isEqual = false;
	let received = [];
	let error;
	try {
		received = await getOutput(data);
		isEqual = equal(data.output, received);
	} catch (err) {
		if (!err.code) throw err;
		received = err.receivedData;
		error = err;
	}

	const printFunc = alph && !printAsBytes ? prettyPrintString : prettyPrintBytes;
	const output = printFunc(received);
	const input = printFunc(data.input);
	const expectedOutput = printFunc(data.output);

	if (showInput) {
		console.log(`\nInput was (${data.input.length} bytes):\n`);
		console.log(input);
		console.log();
		if (outputMode > 0) printLine('-');
	}

	if (outputMode === 1) {
		console.log(`\nYour output (${received.length} bytes):`);
		console.log(output);
		console.log();
		printLine('-');
		console.log(`\nExpected output (${data.output.length} bytes):`);
		console.log(expectedOutput);
	} else if (outputMode === 2) {
		console.log();
		if (!alph) {
			console.log('Sorry, diff for nonlatin tests is currently not supported.');
		} else {
			try {
				const diff = await execCommand(`diff -W ${process.stdout.columns} --side-by-side <( printf '%s\n' ${output} ) <( printf '%s\n' ${expectedOutput} )`);
				console.log(diff);

				const left = `LEFT: Yours (${received.length} bytes)`;
				const right = `RIGHT: Expected (${data.output.length} bytes)`;
				console.log(`${left}${' '.repeat(process.stdout.columns / 2 - left.length)}${right}`);
			} catch (error) {
				console.log('An error occured while executing diff:');
				console.log(error);
			}
		}
	}

	if (!isEqual && outputMode > 0) {
		console.log();
		console.log(' ' + '-'.repeat(41));
		console.log(' - Did you maybe not restart the server? -');
		console.log(' ' + '-'.repeat(41));
	}

	if (error) throw new Error(error.code);

	return isEqual;
};

const generateResultString = (passed, error) => passed ?
	colors.green + 'PASSED' + colors.reset :
	colors.red + (error || 'FAILED') + colors.reset;

const runTest = async ({name, run}, showInput, outputMode, printBytes) => {
	const showResultAtBottom = showInput || outputMode > 0;

	process.stdout.write(`Running ${name}... `);
	if (showResultAtBottom) console.log('\n');

	let passed = false;
	let error = '';
	try {
		passed = await run(showInput, outputMode, printBytes);
	} catch (err) {
		passed = false;
		error = err.message;
	}

	const resultString = generateResultString(passed, error);
	console.log(`${showResultAtBottom ? '\nResult: ' : ''}${resultString}`)

	return passed;
};

/* ======================================= */

const generateRandomTests = (name, count, cmdCount, keyLen, valueLen, randFunc) => {
	const tests = {};
	for (let i = 0; i < count; i++) {
		const distinctName = `random_${name}_${i+1}`;
		rand = new alea(SEED + distinctName);
		tests[distinctName] = () => generatePrimitiveTest(distinctName, randCmdList(cmdCount, keyLen, valueLen, randFunc), randFunc === randAlphByteString);
	}
	return tests;
};

const compileInvalidCmds = (name, cmds) => cmds.reduce((o, c, i) => {
	const distinctName = `${name}_${i+1}`;
	rand = new alea(SEED + name);
	return {
		...o,
		[distinctName]: () => generatePrimitiveTest(distinctName,
			[
				...randCmdList(3, 5, 5, randAlphByteString, true),
				{ raw: stbs(c), out: [] }
			], true)
	};
}, {});

const generateConcurrentTest = (name, clientCount, cmdCount) => {
	rand = new alea(SEED + name);
	const key = randAlphByteString(10);

	const finalValues = [];
	const testData = [];
	for (let i = 0; i < clientCount; i++) {
		const cmds = [];
		for (let j = 0; j < cmdCount; j++)
			cmds.push({ cmd: 'SET', key, value: randAlphByteString(3) });
		finalValues.push(bsts(cmds[cmdCount - 1].value));
		cmds.push({ raw: [...QUIT, NEW_LINE], out: '' });
		testData.push({ input: Uint8Array.from(generateInput(cmds, name)) });
	}

	const run = async (si, om, pb) => {
		let finalValue = '';
		try {
			await Promise.all(testData.map(getOutput));
			finalValue = await getOutput({ input: Uint8Array.from(generateInput([
				{ cmd: 'GET', key },
				{ raw: [...QUIT, NEW_LINE], out: '' }
			], name)) })
		} catch (error) {
			if (error.code) throw new Error(error.code);
			else throw error;
		}

		try {
			finalValue = u8ts(finalValue).split('$')[2].split('\n')[0];
		} catch (error) {
			if (om > 0) console.log('\nThe server responded with a weird string: ' + u8ts(finalValue));
			return false;
		}

		const passed = finalValues.includes(finalValue);

		if (om > 0) {
			console.log(`Expected one of the following values:\n  - ${finalValues.join('\n  - ')}\n`);
			printLine('-');
			console.log(`\nThe server responded with the following:\n  - ${finalValue}`);
		}

		return passed;
	}

	return { name, run };
};

console.log('Collecting tests...');
const testGenerators = {
	'default': () => {
		rand = new alea(SEED + 'default');
		return generatePrimitiveTest('default', [
			{ cmd: 'GET', key: stbs('hallo') },
			{ cmd: 'SET', key: stbs('hallo'), value: stbs('welt') },
			{ cmd: 'GET', key: stbs('hallo') }
		], true);
	},

	// Random
	...generateRandomTests('small', 5, 10, 5, 10, randAlphByteString),
	...generateRandomTests('medium', 5, 100, 50, 100, randAlphByteString),
	...generateRandomTests('large', 5, 1000, 500, 1000, randAlphByteString),

	'few_but_big': () => {
		rand = new alea(SEED + 'few_but_big');
		return generatePrimitiveTest('few_but_big', randCmdList(5, 50000, 100000, randAlphByteString), true);
	},

	// Special data
	'str_containing_newline': () => {
		rand = new alea(SEED + 'str_containing_newline');
		return generatePrimitiveTest('str_containing_newline', [
			{ cmd: 'GET', key: stbs('123\n123\n\n') },
			{ cmd: 'SET', key: stbs('123\n123\n\n'), value: stbs('\n12\n4198\niufds') },
			{ cmd: 'GET', key: stbs('123\n123\n\n') }
		]);
	},
	'str_containing_nullbyte': () => {
		rand = new alea(SEED + 'str_containing_nullbyte');
		return generatePrimitiveTest('str_containing_nullbyte', [
			{ cmd: 'GET', key: stbs('123\x00123\x00\x00') },
			{ cmd: 'SET', key: stbs('123\x00123\x00\x00'), value: stbs('\x0012\x004198\x00iufds') },
			{ cmd: 'GET', key: stbs('123\x00123\x00\x00') }
		]);
	},

	// Invalid
	...compileInvalidCmds('invalid_cmd_name', [
		`get$3$123\n`,
		`get$4$1234\n`,
		`set$5$12345$1$a\n`,
		`set$6$123456$4$abcd\n`,
		`${randAlphString(2)}$3$123\n`,
		`${randAlphString(2)}$4$1234\n`,
		`${randAlphString(2)}$5$12345\n`,
		`${randAlphString(2).toUpperCase()}$5$12345\n`,
		`${randAlphString(2).toUpperCase()}$5$12345\n`,
		`${randAlphString(2).toUpperCase()}$5$12345\n`,
		`${randAlphString(5)}$3$123\n`,
		`${randAlphString(5)}$4$1234\n`,
		`${randAlphString(5)}$5$12345\n`,
		`${randAlphString(5).toUpperCase()}$5$12345\n`,
		`${randAlphString(5).toUpperCase()}$5$12345\n`,
		`${randAlphString(5).toUpperCase()}$5$12345\n`
	]),

	...compileInvalidCmds('invalid_arg_count', [
		`GET$3$123$3$abc\n`,
		`GET$1$a$3$abc\n`,
		`SET$1$a\n`,
		`SET$2$bc\n`
	]),

	...compileInvalidCmds('invalid_zero_len_str', [
		'GET$0$\n',
		'GET$0$123\n',
		'SET$0$123$0$123\n',
		'SET$3$123$0$\n',
		'SET$0$$3$123\n',
		'SET$2$123$0$\n',
		'SET$0$$3$123\n',
		'SET$5$12345$0$\n',
		'SET$0$$5$12345\n'
	]),

	...compileInvalidCmds('invalid_non_num_len', [
		'GET$abc$12\n',
		'GET$0be$123\n',
		'SET$12bc$123$3$123\n',
		'SET$12b$123$3$abc\n',
		'SET$bd1$bbc$3$123\n'
	]),

	...[
		{ pre: `SET`, post: `$3$abc\n`, out: 'OK\n', len: MAX_STRING_LEN },
		{ pre: `SET`, post: `$3$abc\n`, out: '', len: MAX_STRING_LEN + 1 },
		{ pre: `SET$3$abc`, post: `\n`, out: '', len: MAX_STRING_LEN + 1 },
		{ pre: `GET`, post: `\n`, out: '', len: MAX_STRING_LEN + 1 },
		{ pre: `SET`, post: `$3$abc\n`, out: 'OK\n', len: MAX_STRING_LEN }
	].reduce((o, { pre, post, out, len }, i) => {
		const name = `invalid_too_long_str_${i+1}`;
		rand = new alea(SEED + name);
		return {
			...o,
			[name]: () => {
				const raw = stbs(`${pre}$${len}$${randAlphString(len)}${post}`);
				return generatePrimitiveTest(
					name,
					[
						...randCmdList(3, 5, 5, randAlphByteString, true),
						{ raw, out: stbs(out) }
					],
					true
				)
			}
		};
	}, {}),

	...compileInvalidCmds('invalid_zero_prepended_str_lens', [
		'GET$03$123\n',
		'SET$02$12$3$123\n',
		'SET$03$123$1$a\n',
		'SET$1$a$03$123\n',
		'SET$02$12$1$a\n',
		'SET$05$abcde$3$123\n',
		'SET$05$12345$1$a\n',
		'SET$2$ab$05$12345\n'
	]),

	// Random Nonlatin
	...generateRandomTests('nonlatin_small', 5, 10, 5, 10, randByteString),
	...generateRandomTests('nonlatin_medium', 5, 100, 50, 100, randByteString),
	...generateRandomTests('nonlatin_large', 5, 1000, 500, 1000, randByteString),

	// Concurrent
	'concurrent_small': () => generateConcurrentTest('concurrent_small', 10, 10),
	'concurrent_medium': () => generateConcurrentTest('concurrent_medium', 100, 100),
	'concurrent_large': () => generateConcurrentTest('concurrent_large', 1000, 1000),

	// TODO test slow client?
	// TODO test out of memory?

	// Dummy
	'dummy': () => ({
		name: 'dummy',
		run: () => true
		// run: async () => true
	})

	// ===================================================
	//                ADD MORE TESTS HERE
	// ===================================================

	/*
	 * A test has the format of
	 *
	 * {
	 *   name: 'abc',
	 *   run: (showInput, outputMode, printBytes) => { ... }
	 * }
	 *
	 * 'run' is supposed to return a boolean indicating the success of the
	 * test. It can also throw an error using 'throw new Error('smth happened')'.
	 * Other than that, you are completely free to do whatever you want.
	 */
};

// Args
const hasArg = arg => process.argv.includes(arg);

const help = hasArg('-h') || hasArg('--help');
const runAll = hasArg('-a') || hasArg('--all');
const printAsBytes = hasArg('-b') || hasArg('--bytes');
const outputMode =	!printAsBytes && (hasArg('-d') || hasArg('--diff')) ? 2 :
					(printAsBytes || hasArg('-o') || hasArg('--output')) ? 1 :
					0;
const showInput = hasArg('-i') || hasArg('--input');

const testNames = Object.keys(testGenerators);

const main = async () => {
	if (help || process.argv.length < 3) {
		console.log(
`Usage: node test.js [test-name] [...flags]
  -h, --help       Shows this help message
  -a, --all        Run all test cases

  -i, --input      Print the input (*)
  -o, --output     Print your output (*)
  -d, --diff       Print the diff to the actual output (*)
  -b, --bytes      Print the byte representation (*)

    (*) Generaly only for single test cases, flag will be ignore when
        running with --all. Additionally, flag might be ignored in some cases
        for instance where it is hard to display (for instance concurrent tests).

Additionally, you can set the following environment variables:
  - HOST (str, default "${DEFAULT_HOST}")
  - PORT (int, default ${DEFAULT_PORT})
  - SEED (str, default "${DEFAULT_SEED}")
  - TIMEOUT (int ms, default ${DEFAULT_TIMEOUT})
  - BYTES_PER_LINE (int, default ${DEFAULT_BYTES_PER_LINE})

Examples:
  Run all tests:                  node test.js --all
  Run test default with output:   node test.js default --output
  Increased timeout:              TIMEOUT=30000 node test.js --all

Available tests (${testNames.length}):
  - ${testNames.join('\n  - ')}
`
		);
		return;
	}
	if (runAll && outputMode > 0)
		console.log('NOTE: --input, --output, --diff and --bytes are ignored when running all tests.');

	if (runAll) {
		console.log('Generating tests...');
		const tests = testNames.map(n => testGenerators[n]());

		console.log('Running all tests... (output will not be shown)\n');

		let score = 0;
		for (let test of tests)
			score += await runTest(test, false, 0, false);

		console.log(`\nScore: ${score}/${testNames.length} ${score === testNames.length ? ':D' : ''}`);
	} else {
		const testName = process.argv[2];
		const generator = testGenerators[testName];
		if (generator === undefined) {
			console.log(`Invalid test ${testName}...`);
			return;
		}

		console.log(`Generating ${testName}...`);
		const test = generator();
		runTest(test, showInput, outputMode, printAsBytes);
	}
};
main();

