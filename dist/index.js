#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const reading_time_1 = __importDefault(require("reading-time"));
const epub2_1 = require("epub2");
const R = __importStar(require("rambda"));
const fs_1 = __importDefault(require("fs"));
const ics = __importStar(require("ics"));
const path_1 = __importDefault(require("path"));
function readUserInput() {
    return process.argv[2] || '';
}
function resolvePath(uri) {
    return path_1.default.resolve(uri);
}
function hasValidExtension(filePath) {
    const VALID_EXTENSIONS = ['.epub'];
    const isValid = VALID_EXTENSIONS.reduce((acc, curr) => acc && filePath.endsWith(curr), true);
    return isValid ? filePath : undefined;
}
const filePathPipe = R.pipe(readUserInput, resolvePath, hasValidExtension);
function mapChapters(epub) {
    return epub.toc
        .filter((c) => c.level === 0)
        .map((chapter) => (Object.assign({ title: chapter.title }, epub.spine.find((item) => chapter.href.includes(item.href)))));
}
function filterChapters(list) {
    const BLACKLIST = [
        'acknowledgment',
        'acknowledgments',
        'notes',
        'note',
        'index',
        'contents',
        'copyright',
        'title',
        'epigraph',
        'title page',
    ];
    return list.filter((chapter) => !BLACKLIST.find((i) => i === String(chapter.title).toLowerCase()));
}
function mapResolvedChapters(list, epub) {
    return Promise.all(list.map((chapter) => new Promise((resolve) => epub.getChapterAsync(chapter.id).then((raw) => {
        resolve({
            title: chapter.title,
            raw,
        });
    }))));
}
const pipeChapters = R.pipe(mapChapters, filterChapters);
function escapeHtml(str) {
    return str.replace(/<\/?[^>]+(>|$)/g, '');
}
function escapeControlChars(str) {
    return str.replace(/[\r\n\t]/g, '');
}
function addDays(date, number) {
    const newDate = new Date(date);
    return new Date(newDate.setDate(newDate.getDate() + number));
}
const normalizeTextPipe = R.pipe(escapeHtml, escapeControlChars);
function main() {
    const filePath = filePathPipe();
    if (!filePath) {
        return console.error('provide correct path');
    }
    epub2_1.EPub.createAsync(filePath, '', '').then((EPUB) => {
        const chapters = pipeChapters({ toc: EPUB.toc, spine: EPUB.spine.contents });
        mapResolvedChapters(chapters, EPUB).then((rawChapters) => {
            const requirements = rawChapters
                .map((chapter) => (Object.assign(Object.assign({}, chapter), { raw: normalizeTextPipe(chapter.raw) })))
                .map((chapter) => {
                const read = (0, reading_time_1.default)(chapter.raw);
                return Object.assign(Object.assign({}, chapter), { read, estimate: Math.ceil(read.minutes) });
            }).reduce((acc, curr) => {
                const lastItem = acc.length === 0 ? false : acc[acc.length - 1];
                if (lastItem && lastItem.total.minutes < 60) {
                    acc[acc.length - 1] = {
                        items: [...lastItem.items, curr],
                        total: { minutes: lastItem.total.minutes + curr.read.minutes },
                    };
                    return acc;
                }
                else {
                    return [
                        ...acc,
                        { items: [curr], total: { minutes: curr.read.minutes } },
                    ];
                }
            }, []);
            console.table(requirements);
            const events = requirements.map((item, i) => {
                const date = addDays(Date.now(), i + 7);
                return {
                    start: [
                        date.getUTCFullYear(),
                        date.getUTCMonth() + 1,
                        date.getUTCDate(),
                        6,
                        0,
                    ],
                    duration: {
                        hours: Math.floor(item.total.minutes / 60),
                        minutes: item.total.minutes % 60,
                    },
                    title: "Reading Books",
                    description: item.items.map((i) => i.title).join("\n"),
                    categories: ["reading"],
                    busyStatus: "BUSY",
                };
            });
            ics.createEvents(events, (error, value) => {
                if (error) {
                    return console.error(error);
                }
                fs_1.default.writeFileSync(`${path_1.default.resolve(process.cwd())}/events.ics`, value, "utf-8");
            });
        });
    });
}
main();
