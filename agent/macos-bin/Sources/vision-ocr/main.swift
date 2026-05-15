import AppKit
import CoreGraphics
import Foundation
import PDFKit
import Vision

let RECOGNITION_LANGUAGES = ["en-US", "es-ES"]
let PDF_RENDER_LONG_EDGE: CGFloat = 2000

func die(_ msg: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
    exit(code)
}

func recognize(cgImage: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = RECOGNITION_LANGUAGES

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    let observations = request.results ?? []
    return observations
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n")
}

func cgImageFromImageFile(_ path: String) -> CGImage? {
    guard let nsImage = NSImage(contentsOfFile: path) else { return nil }
    var rect = NSRect(origin: .zero, size: nsImage.size)
    return nsImage.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func renderPDFPage(_ page: PDFPage, longEdge: CGFloat) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let scale = longEdge / max(bounds.width, bounds.height)
    let pixelW = Int(bounds.width * scale)
    let pixelH = Int(bounds.height * scale)

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil,
        width: pixelW,
        height: pixelH,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    ctx.setFillColor(CGColor.white)
    ctx.fill(CGRect(x: 0, y: 0, width: pixelW, height: pixelH))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    return ctx.makeImage()
}

func ocrImage(_ path: String) throws -> String {
    guard let cgImage = cgImageFromImageFile(path) else {
        die("vision-ocr: could not decode image at \(path)")
    }
    return try recognize(cgImage: cgImage)
}

func ocrPDF(_ path: String) throws -> String {
    let url = URL(fileURLWithPath: path)
    guard let doc = PDFDocument(url: url) else {
        die("vision-ocr: could not open PDF at \(path)")
    }
    var pieces: [String] = []
    for i in 0..<doc.pageCount {
        guard let page = doc.page(at: i) else { continue }
        guard let cgImage = renderPDFPage(page, longEdge: PDF_RENDER_LONG_EDGE) else {
            FileHandle.standardError.write(Data("vision-ocr: failed to render page \(i + 1)\n".utf8))
            continue
        }
        let text = try recognize(cgImage: cgImage)
        if !text.isEmpty {
            pieces.append("--- page \(i + 1) ---\n\(text)")
        }
    }
    return pieces.joined(separator: "\n\n")
}

let args = CommandLine.arguments
guard args.count == 2 else {
    die("usage: vision-ocr <path-to-image-or-pdf>", 2)
}

let path = args[1]
guard FileManager.default.fileExists(atPath: path) else {
    die("vision-ocr: file not found: \(path)")
}

let ext = (path as NSString).pathExtension.lowercased()
let pdfExts: Set<String> = ["pdf"]
let imageExts: Set<String> = ["png", "jpg", "jpeg", "webp", "heic", "heif", "tiff", "tif", "gif", "bmp"]

do {
    let output: String
    if pdfExts.contains(ext) {
        output = try ocrPDF(path)
    } else if imageExts.contains(ext) {
        output = try ocrImage(path)
    } else {
        die("vision-ocr: unsupported extension .\(ext)")
    }
    FileHandle.standardOutput.write(Data(output.utf8))
} catch {
    die("vision-ocr: \(error)")
}
