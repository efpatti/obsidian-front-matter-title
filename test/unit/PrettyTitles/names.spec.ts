import { humanize, prefixOf, slugify, withoutPrefix } from "@src/PrettyTitles/names";

describe("pretty title filename policy", () => {
    test.each([
        ["Analog vs. Digital: what's different?", "analog-vs-digital-whats-different"],
        ["Olá, mundo! / C++ & sinais (2)", "ola-mundo-c-sinais-2"],
        ["  A___B---C  ", "a-b-c"],
        ['A\\B|C<>D"E', "a-b-c-de"],
        ["CON", "note-con"],
        ["中文：标题？", "中文-标题"],
        ["Systems 🚀 and signals", "systems-and-signals"],
    ])("%s → %s", (input, expected) => expect(slugify(input)).toBe(expected));
    test("rejects punctuation-only names", () => expect(() => slugify("?!...")).toThrow());
    test("separates structural numbers without deleting numbers inside a title", () => {
        expect(prefixOf("12-example")).toBe("12-");
        expect(withoutPrefix("12-Analog: 8 bits?")).toBe("Analog: 8 bits?");
        expect(withoutPrefix("1984: A Novel")).toBe("1984: A Novel");
        expect(humanize("2-analog-vs-digital-systems")).toBe("Analog vs Digital Systems");
    });
});
