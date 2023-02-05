#!/usr/bin/env node

import readingTime, { ReadTimeResults } from 'reading-time'
import { EPub as epub } from 'epub2'
import * as R from 'rambda'
import fs from 'fs'
import * as ics from 'ics'
import path from 'path'

type EpubType = {
    toc: TableOfContentsItemType[]
    spine: SpineContentItemType[]
}

type TableOfContentsItemType = {
    level: number
    order: number
    title: string
    href: string
    id: string
}

type SpineContentItemType = {
    href: string
    id: string
}

type ChapterType = {
    href: string
    id: string
    title: string
}

type ResolvedChapterType = { title: string; raw: string }

function readUserInput() {
    return process.argv[2] || ''
}

function resolvePath(uri: string) {
    return path.resolve(uri)
}

function hasValidExtension(filePath: string) {
    const VALID_EXTENSIONS = ['.epub']
    const isValid = VALID_EXTENSIONS.reduce((acc, curr) => acc && filePath.endsWith(curr), true)
    const doesExist = fs.statSync(filePath).isFile()
    return (isValid && doesExist) ? filePath : undefined
}

const filePathPipe = R.pipe(readUserInput, resolvePath, hasValidExtension)

function mapChapters(epub: EpubType): ChapterType[] {
    return epub.toc
        .filter((c) => c.level === 0)
        .map((chapter) => ({
            title: chapter.title,
            ...epub.spine.find((item) => chapter.href.includes(item.href))!,
        }))
}

function filterChapters(list: ChapterType[]) {
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
    ]
    return list.filter((chapter) => !BLACKLIST.find((i) => i === String(chapter.title).toLowerCase()))
}

function mapResolvedChapters(list: ChapterType[], epub: any) {
    return Promise.all(
        list.map(
            (chapter) =>
                new Promise<ResolvedChapterType>((resolve) =>
                    epub.getChapterAsync(chapter.id).then((raw: string) => {
                        resolve({
                            title: chapter.title,
                            raw,
                        })
                    })
                )
        )
    )
}

const pipeChapters = R.pipe(mapChapters, filterChapters)

function escapeHtml(str: string) {
    return str.replace(/<\/?[^>]+(>|$)/g, '')
}

function escapeControlChars(str: string) {
    return str.replace(/[\r\n\t]/g, '')
}

function addDays(date: number, number: number) {
    const newDate = new Date(date)
    return new Date(newDate.setDate(newDate.getDate() + number))
}


const normalizeTextPipe = R.pipe(escapeHtml, escapeControlChars)

function main(): void {
    const filePath = filePathPipe()
    if (!filePath) {
        return console.error('provide correct path')
    }
    epub.createAsync(filePath, '', '').then((EPUB: any) => {
        const chapters = pipeChapters({ toc: EPUB.toc, spine: EPUB.spine.contents })
        mapResolvedChapters(chapters, EPUB).then((rawChapters) => {
            const requirements = rawChapters
                .map((chapter) => ({
                    ...chapter,
                    raw: normalizeTextPipe(chapter.raw),
                }))
                .map((chapter) => {
                    const read = readingTime(chapter.raw)
                    return {
                        ...chapter,
                        read,
                        estimate: Math.ceil(read.minutes)
                    }
                }).reduce((acc, curr) => {
                    const lastItem = acc.length === 0 ? false : acc[acc.length - 1];
                    if (lastItem && lastItem.total.minutes < 60) {
                        acc[acc.length - 1] = {
                            items: [...lastItem.items, curr],
                            total: { minutes: lastItem.total.minutes + curr.read.minutes },
                        };
                        return acc;
                    } else {
                        return [
                            ...acc,
                            { items: [curr], total: { minutes: curr.read.minutes } },
                        ];
                    }
                }, [] as {
                    total: { minutes: number }, items: {
                        read: ReadTimeResults;
                        estimate: number;
                        raw: string;
                        title: string;
                    }[]
                }[])

            console.table(requirements.map(req => ({
                chapters: req.items.map(i => i.title.slice(0, 13).concat('...')),
                estimate: `${req.total.minutes} minutes`
            })))

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
            }) as ics.EventAttributes[];
            ics.createEvents(events, (error, value) => {
                if (error) {
                    return console.error(error);
                }
                fs.writeFileSync(`${path.resolve(process.cwd())}/events.ics`, value, "utf-8");
            })
        })
    })
}

main()