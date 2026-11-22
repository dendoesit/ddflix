// JPEG frames + WAV -> H.264 High mp4 (AAC audio) with AVFoundation.
// usage: encode <framesDir> <wav> <out.mp4> <fps> <bitrate>
import AVFoundation
import AppKit
let a = CommandLine.arguments
let dir = URL(fileURLWithPath: a[1]), wav = URL(fileURLWithPath: a[2]), out = URL(fileURLWithPath: a[3])
let fps = Int32(a[4])!, bitrate = Int(a[5])!
try? FileManager.default.removeItem(at: out)
let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".jpg") }.sorted()
let w = try AVAssetWriter(outputURL: out, fileType: .mp4)
let vin = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 1920, AVVideoHeightKey: 1080,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bitrate, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoMaxKeyFrameIntervalKey: 60, AVVideoExpectedSourceFrameRateKey: fps]])
vin.expectsMediaDataInRealTime = false
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vin, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: 1920, kCVPixelBufferHeightKey as String: 1080])
w.add(vin)
let ain = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192000])
ain.expectsMediaDataInRealTime = false
w.add(ain)
let asset = AVURLAsset(url: wav), reader = try AVAssetReader(asset: asset)
let rout = AVAssetReaderTrackOutput(track: asset.tracks(withMediaType: .audio)[0], outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
reader.add(rout); reader.startReading()
w.startWriting(); w.startSession(atSourceTime: .zero)
// interleave video and audio appends (feeding one track to the end first deadlocks the writer)
var vi = 0, vDone = false, aDone = false
while !(vDone && aDone) {
  var progressed = false
  if !vDone && vin.isReadyForMoreMediaData {
    if vi >= files.count { vin.markAsFinished(); vDone = true } else {
      let img = NSImage(contentsOf: dir.appendingPathComponent(files[vi]))!
      var pb: CVPixelBuffer?; CVPixelBufferPoolCreatePixelBuffer(nil, ad.pixelBufferPool!, &pb)
      CVPixelBufferLockBaseAddress(pb!, [])
      let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb!), width: 1920, height: 1080, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb!), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
      var r = CGRect(x: 0, y: 0, width: 1920, height: 1080)
      ctx.draw(img.cgImage(forProposedRect: &r, context: nil, hints: nil)!, in: r)
      CVPixelBufferUnlockBaseAddress(pb!, [])
      ad.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(vi), timescale: fps)); vi += 1
    }
    progressed = true
  }
  if !aDone && ain.isReadyForMoreMediaData {
    if let sb = rout.copyNextSampleBuffer() { ain.append(sb) } else { ain.markAsFinished(); aDone = true }
    progressed = true
  }
  if !progressed { usleep(1000) }
}
let sem = DispatchSemaphore(value: 0); w.finishWriting { sem.signal() }; sem.wait()
print(w.status == .completed ? "ok \(files.count) frames" : "fail \(String(describing: w.error))")
