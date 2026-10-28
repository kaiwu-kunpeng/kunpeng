export const part04: string = `      function kpOfficeName(name) {
        return /[.](?:docx|pptx|xlsx)$/i.test(String(name || ""));
      }
      function kpPdfName(name) {
        return /[.]pdf$/i.test(String(name || ""));
      }
      async function kpPdfExtract(file, name) {
        var pdfjs = await import("/api/vendor/pdfjs?f=build/pdf.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/api/vendor/pdfjs?f=build/pdf.worker.min.mjs";
        var loadingTask = pdfjs.getDocument({
          data: await file.arrayBuffer(),
          cMapUrl: "/api/vendor/pdfjs?f=cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/api/vendor/pdfjs?f=standard_fonts/"
        });
        var pdf = await loadingTask.promise;
        var pages = [];
        var hasText = false;
        for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          var page = await pdf.getPage(pageNumber);
          var content = await page.getTextContent();
          var pageText = Array.prototype.map.call(content.items || [], function (item) {
            return item && typeof item.str === "string" ? item.str : "";
          }).join(" ").trim();
          if (pageText) hasText = true;
          pages.push("【第" + pageNumber + "页】\\n" + pageText);
        }
        return kpLimitOfficeText(hasText ? pages.join("\\n") : "");
      }
      function kpIsImageAttachment(file) {
        var type = String(file && file.type || "").toLowerCase();
        return type.indexOf("image/") === 0 || /[.](?:png|jpe?g|gif|webp|svg)$/i.test(String(file && file.name || ""));
      }
      function kpIsTextAttachment(file) {
        var type = String(file && file.type || "").toLowerCase();
        return type.indexOf("text/") === 0 || type === "application/json" || /[.](?:txt|md|json|csv)$/i.test(String(file && file.name || ""));
      }
      function kpIsPdfAttachment(file) {
        return /[.]pdf$/i.test(String(file && file.name || ""));
      }
      function kpIsZipAttachment(file) {
        return /[.]zip$/i.test(String(file && file.name || ""));
      }
      function kpAttachmentEvent(message, error) {
        appendLine(log, '<div class="kp-ev kp-ev-' + (error ? "error" : "done") + '">' + esc(message) + '</div>');
      }
      function kpSafeImageName(name) {
        var base = String(name || "image").replace(/[.][^.]*$/, "");
        return (base || "image") + ".safe.jpg";
      }
      function kpDecodeImage(file) {
        if (typeof createImageBitmap === "function") {
          return createImageBitmap(file).then(function (bitmap) {
            return {
              source: bitmap,
              width: bitmap.width,
              height: bitmap.height,
              cleanup: function () { if (typeof bitmap.close === "function") bitmap.close(); }
            };
          });
        }
        return new Promise(function (resolve, reject) {
          var image = new Image();
          var objectUrl = "";
          try { objectUrl = URL.createObjectURL(file); }
          catch (error) { reject(error); return; }
          image.onload = function () {
            resolve({
              source: image,
              width: image.naturalWidth || image.width,
              height: image.naturalHeight || image.height,
              cleanup: function () { URL.revokeObjectURL(objectUrl); }
            });
          };
          image.onerror = function () {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("图片解码失败"));
          };
          image.src = objectUrl;
        });
      }
      async function kpCompressRemoteImage(file) {
        var decoded = await kpDecodeImage(file);
        try {
          if (!decoded.width || !decoded.height) throw new Error("图片尺寸无效");
          var scale = Math.min(1, 1280 / Math.max(decoded.width, decoded.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(decoded.width * scale));
          canvas.height = Math.max(1, Math.round(decoded.height * scale));
          var context = canvas.getContext("2d");
          if (!context) throw new Error("浏览器不支持 canvas 压缩");
          context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
          var blob = await new Promise(function (resolve, reject) {
            try {
              canvas.toBlob(function (result) {
                if (result) resolve(result);
                else reject(new Error("JPEG 生成失败"));
              }, "image/jpeg", 0.72);
            } catch (error) { reject(error); }
          });
          return new File([blob], kpSafeImageName(file && file.name), { type: "image/jpeg" });
        } finally {
          decoded.cleanup();
        }
      }
      function kpUploadRawAttachment(file) {
        return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onerror = function () { reject(new Error("读取附件失败")); };
        fr.onload = function () {
          var dataUrl = typeof fr.result === "string" ? fr.result : "";
          if (!dataUrl) { reject(new Error("附件 dataURL 转换失败")); return; }
          fetch("/api/workspace/" + encodeURIComponent(currentProjectId()) + "/upload", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: file.name || "", dataUrl: dataUrl })
          }).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !j.ok) throw new Error(j && j.error ? j.error : "上传附件失败");
            pendingImgs.push({ id: j.id, url: j.kind === "image" ? dataUrl : "", name: file.name || j.name || "attachment" });
            renderChips();
            resolve(j);
          }).catch(reject);
        };
        fr.readAsDataURL(file);
        });
      }
      function kpConfirmRemoteImage(file) {
        var originalName = String(file && file.name || "image");
        var card = document.createElement("div");
        card.className = "kp-ev kp-ev-gate";
        var message = document.createElement("span");
        message.textContent = "异地机器图片管控:原图不上传 " + originalName;
        var ocrButton = document.createElement("button");
        ocrButton.type = "button";
        ocrButton.className = "b pri";
        ocrButton.textContent = "抽文字后发送(推荐)";
        var uploadButton = document.createElement("button");
        uploadButton.type = "button";
        uploadButton.className = "b";
        uploadButton.textContent = "压缩脱敏后上传";
        var cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "b";
        cancelButton.textContent = "取消";
        card.appendChild(message);
        card.appendChild(ocrButton);
        card.appendChild(uploadButton);
        card.appendChild(cancelButton);
        var empty = log.querySelector(".kp-stream-empty");
        if (empty) empty.remove();
        var stick = nearBottom(log);
        log.appendChild(card);
        notifyChatProjection(log);
        if (stick) log.scrollTop = log.scrollHeight;
        var settled = false;
        var busy = false;
        function setChoiceDisabled(disabled) {
          ocrButton.disabled = disabled;
          uploadButton.disabled = disabled;
          cancelButton.disabled = disabled;
        }
        cancelButton.addEventListener("click", function () {
          if (settled || busy) return;
          settled = true;
          card.className = "kp-ev kp-ev-done";
          card.textContent = "已取消,图片未上传";
          notifyChatProjection(log);
        });
        ocrButton.addEventListener("click", function () {
          if (settled || busy) return;
          busy = true;
          setChoiceDisabled(true);
          message.textContent = "识别中… " + originalName;
          kpRecognizeRemoteImage(file).then(function (result) {
            var text = String(result && result.data && result.data.text || "").trim();
            if (!text) {
              busy = false;
              setChoiceDisabled(false);
              message.textContent = "未识别到文字,可改用压缩图(需确认)";
              notifyChatProjection(log);
              return;
            }
            var preview = document.createElement("textarea");
            preview.className = "kp-ocr-preview";
            preview.rows = 6;
            preview.value = text;
            preview.setAttribute("aria-label", "OCR 文字预览,发送前可编辑");
            var sendTextButton = document.createElement("button");
            sendTextButton.type = "button";
            sendTextButton.className = "b pri";
            sendTextButton.textContent = "发送文字";
            var abandonButton = document.createElement("button");
            abandonButton.type = "button";
            abandonButton.className = "b";
            abandonButton.textContent = "放弃";
            ocrButton.hidden = true;
            uploadButton.hidden = true;
            cancelButton.hidden = true;
            message.textContent = "请审阅并编辑 OCR 文字,确认后再发送";
            card.appendChild(preview);
            card.appendChild(sendTextButton);
            card.appendChild(abandonButton);
            busy = false;
            sendTextButton.addEventListener("click", function () {
              if (settled || busy) return;
              var reviewedText = String(preview.value || "").trim();
              if (!reviewedText) {
                message.textContent = "未识别到文字,可改用压缩图(需确认)";
                return;
              }
              busy = true;
              sendTextButton.disabled = true;
              abandonButton.disabled = true;
              message.textContent = "正在发送已确认的 OCR 文字";
              var textFile = new File([reviewedText], originalName + ".ocr.txt", { type: "text/plain;charset=utf-8" });
              kpUploadRawAttachment(textFile).then(function () {
                settled = true;
                card.className = "kp-ev kp-ev-done";
                card.textContent = "已发送 OCR 文本 " + reviewedText.length + " 字(原图未离开本机)";
                notifyChatProjection(log);
              }).catch(function (error) {
                var reason = error instanceof Error ? error.message : String(error);
                busy = false;
                sendTextButton.disabled = false;
                abandonButton.disabled = false;
                message.textContent = "OCR 文本上传失败:" + reason + ",原图未上传";
                notifyChatProjection(log);
              });
            });
            abandonButton.addEventListener("click", function () {
              if (settled || busy) return;
              settled = true;
              card.className = "kp-ev kp-ev-done";
              card.textContent = "已放弃 OCR 文本,图片未上传";
              notifyChatProjection(log);
            });
            preview.focus();
            notifyChatProjection(log);
          }).catch(function () {
            busy = false;
            setChoiceDisabled(false);
            message.textContent = "未识别到文字,可改用压缩图(需确认)";
            notifyChatProjection(log);
          });
        });
        uploadButton.addEventListener("click", function () {
          if (settled || busy) return;
          settled = true;
          setChoiceDisabled(true);
          message.textContent = "正在本地压缩脱敏 " + originalName + ",原图不上传";
          kpCompressRemoteImage(file).then(function (safeFile) {
            return kpUploadRawAttachment(safeFile).then(function () { return safeFile.name; });
          }).then(function (safeName) {
            card.className = "kp-ev kp-ev-done";
            card.textContent = "已上传压缩版 " + safeName + "(原图未离开本机,EXIF 已剥离)";
            notifyChatProjection(log);
          }).catch(function (error) {
            var reason = error instanceof Error ? error.message : String(error);
            card.className = "kp-ev kp-ev-error";
            card.textContent = "本地压缩失败:" + reason + ",原图未上传";
            notifyChatProjection(log);
          });
        });
      }
      function kpPdfTextName(name) {
        var base = String(name || "document.pdf").replace(/[.]pdf$/i, "");
        return (base || "document") + ".pdf.txt";
      }
      function kpPdfTextWithinLimit(text) {
        var maxBytes = 2 * 1024 * 1024;
        var encoder = new TextEncoder();
        var value = String(text || "");
        if (encoder.encode(value).byteLength <= maxBytes) return { text: value, truncated: false };
        var note = "已截断\\n";
        var available = maxBytes - encoder.encode(note).byteLength;
        var low = 0;
        var high = value.length;
        while (low < high) {
          var middle = Math.ceil((low + high) / 2);
          if (encoder.encode(value.slice(0, middle)).byteLength <= available) low = middle;
          else high = middle - 1;
        }
        if (low > 0 && /[\\uD800-\\uDBFF]/.test(value.charAt(low - 1))) low--;
        return { text: note + value.slice(0, low), truncated: true };
      }
      async function kpExtractRemotePdf(file, onProgress) {
        var pdfjs = await kpEnsurePdfjs();
        var arrayBuffer = await file.arrayBuffer();
        var pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        var pages = [];
        for (var p = 1; p <= pdf.numPages; p++) {
          onProgress(p, pdf.numPages);
          var page = await pdf.getPage(p);
          var content = await page.getTextContent();
          var pageText = Array.prototype.map.call(content.items || [], function (item) {
            return item && typeof item.str === "string" ? item.str : "";
          }).join(" ").trim();
          pages.push(pageText);
        }
        return kpPdfTextWithinLimit(pages.join("\\n\\n"));
      }
      function kpZipTextName(name) {
        var base = String(name || "archive.zip").replace(/[.]zip$/i, "");
        return (base || "archive") + ".zip.txt";
      }
      function kpZipTextWithinLimit(text) {
        var maxBytes = 2 * 1024 * 1024;
        var encoder = new TextEncoder();
        var value = String(text || "");
        if (encoder.encode(value).byteLength <= maxBytes) return { text: value, truncated: false };
        var note = "\\n已截断";
        var available = maxBytes - encoder.encode(note).byteLength;
        var low = 0;
        var high = value.length;
        while (low < high) {
          var middle = Math.ceil((low + high) / 2);
          if (encoder.encode(value.slice(0, middle)).byteLength <= available) low = middle;
          else high = middle - 1;
        }
        if (low > 0 && /[\\uD800-\\uDBFF]/.test(value.charAt(low - 1))) low--;
        return { text: value.slice(0, low) + note, truncated: true };
      }
      async function kpZipExtractAll(file, onProgress) {
        var source = file && typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : file;
        if (!(source instanceof ArrayBuffer)) throw new Error("无法读取 ZIP 文件");
        var sections = [];
        var skipped = [];
        var textPattern = /[.](?:txt|md|csv|json|js|ts|py|html|xml|yaml|yml|log)$/i;
        async function visit(archive, basePath, depth) {
          var entries = kpZipEntries(archive);
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var entryName = String(entry.name || "");
            if (!entryName || /[\\/]$/.test(entryName)) continue;
            var path = basePath ? basePath + "/" + entryName : entryName;
            onProgress(i + 1, entries.length, path);
            if (/[.]zip$/i.test(entryName) && depth >= 1) {
              skipped.push("跳过:" + path + "(嵌套过深)");
              continue;
            }
            var supported = kpOfficeName(entryName) || textPattern.test(entryName) || /[.]pdf$/i.test(entryName) || /[.]zip$/i.test(entryName);
            if (!supported) {
              skipped.push("跳过:" + path + "(类型不支持)");
              continue;
            }
            try {
              var bytes = await kpZipRead(archive, entry, true);
              if (/[.]zip$/i.test(entryName)) {
                await visit(bytes, path, depth + 1);
                continue;
              }
              var text = "";
              if (kpOfficeName(entryName)) {
                text = await kpOfficeExtract(bytes, entryName);
              } else if (/[.]pdf$/i.test(entryName)) {
                var pdfFile = new File([bytes], entryName, { type: "application/pdf" });
                var pdfResult = await kpExtractRemotePdf(pdfFile, function () {});
                text = String(pdfResult && pdfResult.text || "");
              } else {
                text = new TextDecoder("utf-8").decode(new Uint8Array(bytes));
              }
              text = String(text || "").trim();
              if (text && text !== "已截断") {
                sections.push("===== 文件: " + path + " =====\\n" + text);
              } else {
                skipped.push("跳过:" + path + "(文本为空)");
              }
            } catch (error) {
              var reason = error instanceof Error ? error.message : String(error);
              skipped.push("跳过:" + path + "(抽取失败:" + reason + ")");
            }
          }
        }
        await visit(source, "", 0);
        var skipSection = "===== 跳过清单 =====\\n" + (skipped.length ? skipped.join("\\n") : "(无)");
        var combined = sections.join("\\n\\n") + (sections.length ? "\\n\\n" : "") + skipSection;
        var limited = kpZipTextWithinLimit(combined);
        return { text: limited.text, truncated: limited.truncated, extracted: sections.length, skipped: skipped };
      }
      function kpConfirmRemoteZip(file) {
        var originalName = String(file && file.name || "archive.zip");
        var card = document.createElement("div");
        card.className = "kp-ev kp-ev-gate";
        var message = document.createElement("span");
        message.textContent = "解包抽取中… 0/?";
        card.appendChild(message);
        var empty = log.querySelector(".kp-stream-empty");
        if (empty) empty.remove();
        var stick = nearBottom(log);
        log.appendChild(card);
        notifyChatProjection(log);
        if (stick) log.scrollTop = log.scrollHeight;
        var settled = false;
        var busy = true;
        kpZipExtractAll(file, function (index, total) {
          message.textContent = "解包抽取中… " + index + "/" + total;
          notifyChatProjection(log);
        }).then(function (result) {
          if (!result || !result.extracted) {
            busy = false;
            card.className = "kp-ev kp-ev-error";
            message.textContent = "包内没有可抽取的文本";
            notifyChatProjection(log);
            return;
          }
          var preview = document.createElement("textarea");
          preview.className = "kp-ocr-preview";
          preview.rows = 10;
          preview.value = result.text;
          preview.setAttribute("aria-label", "ZIP 文字预览,发送前可编辑");
          var sendTextButton = document.createElement("button");
          sendTextButton.type = "button";
          sendTextButton.className = "b pri";
          sendTextButton.textContent = "发送文字";
          var abandonButton = document.createElement("button");
          abandonButton.type = "button";
          abandonButton.className = "b";
          abandonButton.textContent = "放弃";
          message.textContent = result.truncated ? "ZIP 文字预览(已截断,发送前可编辑)" : "ZIP 文字预览(发送前可编辑)";
          card.appendChild(preview);
          card.appendChild(sendTextButton);
          card.appendChild(abandonButton);
          busy = false;
          sendTextButton.addEventListener("click", function () {
            if (settled || busy) return;
            var reviewedText = String(preview.value || "").trim();
            if (!reviewedText) {
              message.textContent = "包内没有可抽取的文本";
              return;
            }
            var limited = kpZipTextWithinLimit(reviewedText);
            reviewedText = limited.text;
            if (limited.truncated) preview.value = reviewedText;
            busy = true;
            sendTextButton.disabled = true;
            abandonButton.disabled = true;
            message.textContent = "正在发送已确认的压缩包文字";
            var textFile = new File([reviewedText], kpZipTextName(originalName), { type: "text/plain;charset=utf-8" });
            kpUploadRawAttachment(textFile).then(function () {
              settled = true;
              card.className = "kp-ev kp-ev-done";
              card.textContent = "已发送压缩包文本 " + reviewedText.length + " 字(原包未离开本机)";
              notifyChatProjection(log);
            }).catch(function (error) {
              var reason = error instanceof Error ? error.message : String(error);
              busy = false;
              sendTextButton.disabled = false;
              abandonButton.disabled = false;
              message.textContent = "压缩包文本上传失败:" + reason + ",原包未上传";
              notifyChatProjection(log);
            });
          });
          abandonButton.addEventListener("click", function () {
            if (settled || busy) return;
            settled = true;
            card.className = "kp-ev kp-ev-done";
            card.textContent = "已放弃压缩包文本,原包未上传";
            notifyChatProjection(log);
          });
          preview.focus();
          notifyChatProjection(log);
        }).catch(function (error) {
          var reason = error instanceof Error ? error.message : String(error);
          busy = false;
          card.className = "kp-ev kp-ev-error";
          message.textContent = "压缩包本地抽取失败:" + reason + ",原包未上传";
          notifyChatProjection(log);
        });
      }
      function kpConfirmRemotePdf(file) {
        var originalName = String(file && file.name || "document.pdf");
        var card = document.createElement("div");
        card.className = "kp-ev kp-ev-gate";
        var message = document.createElement("span");
        message.textContent = "抽取中… 第 0/? 页";
        card.appendChild(message);
        var empty = log.querySelector(".kp-stream-empty");
        if (empty) empty.remove();
        var stick = nearBottom(log);
        log.appendChild(card);
        notifyChatProjection(log);
        if (stick) log.scrollTop = log.scrollHeight;
        var settled = false;
        var busy = true;
        kpExtractRemotePdf(file, function (page, total) {
          message.textContent = "抽取中… 第 " + page + "/" + total + " 页";
          notifyChatProjection(log);
        }).then(function (result) {
          var text = String(result && result.text || "").trim();
          if (!text || text === "已截断") throw new Error("PDF 没有可发送文本");
          var preview = document.createElement("textarea");
          preview.className = "kp-ocr-preview";
          preview.rows = 8;
          preview.value = text;
          preview.setAttribute("aria-label", "PDF 文字预览,发送前可编辑");
          var sendTextButton = document.createElement("button");
          sendTextButton.type = "button";
          sendTextButton.className = "b pri";
          sendTextButton.textContent = "发送文字";
          var abandonButton = document.createElement("button");
          abandonButton.type = "button";
          abandonButton.className = "b";
          abandonButton.textContent = "放弃";
          message.textContent = result.truncated ? "PDF 文字预览(已截断,发送前可编辑)" : "PDF 文字预览(发送前可编辑)";
          card.appendChild(preview);
          card.appendChild(sendTextButton);
          card.appendChild(abandonButton);
          busy = false;
          sendTextButton.addEventListener("click", function () {
            if (settled || busy) return;
            var reviewedText = String(preview.value || "").trim();
            if (!reviewedText) {
              message.textContent = "未抽到文本(可能是扫描件):可把页面截图走图片通道(默认 OCR)";
              return;
            }
            var limited = kpPdfTextWithinLimit(reviewedText);
            reviewedText = limited.text;
            if (limited.truncated) preview.value = reviewedText;
            busy = true;
            sendTextButton.disabled = true;
            abandonButton.disabled = true;
            message.textContent = "正在发送已确认的 PDF 文字";
            var textFile = new File([reviewedText], kpPdfTextName(originalName), { type: "text/plain;charset=utf-8" });
            kpUploadRawAttachment(textFile).then(function () {
              settled = true;
              card.className = "kp-ev kp-ev-done";
              card.textContent = "已发送 PDF 文本 " + reviewedText.length + " 字(原文件未离开本机)";
              notifyChatProjection(log);
            }).catch(function (error) {
              var reason = error instanceof Error ? error.message : String(error);
              busy = false;
              sendTextButton.disabled = false;
              abandonButton.disabled = false;
              message.textContent = "PDF 文本上传失败:" + reason + ",原文件未上传";
              notifyChatProjection(log);
            });
          });
          abandonButton.addEventListener("click", function () {
            if (settled || busy) return;
            settled = true;
            card.className = "kp-ev kp-ev-done";
            card.textContent = "已放弃 PDF 文本,原文件未上传";
            notifyChatProjection(log);
          });
          preview.focus();
          notifyChatProjection(log);
        }).catch(function () {
          busy = false;
          card.className = "kp-ev kp-ev-error";
          message.textContent = "未抽到文本(可能是扫描件):可把页面截图走图片通道(默认 OCR)";
          notifyChatProjection(log);
        });
      }
      function uploadAttachment(file) {
        var originalName = String(file && file.name || "attachment");
        if (kpOfficeName(originalName)) {
          kpOfficeExtract(file, originalName).then(function (text) {
            var extracted = new File([text], originalName + ".extracted.txt", { type: "text/plain;charset=utf-8" });
            kpUploadRawAttachment(extracted).then(function () {
              kpAttachmentEvent("已本地提取 " + originalName + " 文本 " + text.length + " 字符, 原始文件未上传", false);
            }).catch(function () {});
          }, function (error) {
            var reason = error instanceof Error ? error.message : String(error);
            if (kpIsRemoteHost()) {
              kpAttachmentEvent("异地机器原始文件不上传服务器,本地提取失败:" + reason, true);
              return;
            }
            kpUploadRawAttachment(file).catch(function () {});
          });
          return;
        }
        if (kpIsRemoteHost() && kpIsPdfAttachment(file)) {
          kpConfirmRemotePdf(file);
          return;
        }
        if (kpIsRemoteHost() && kpIsZipAttachment(file)) {
          kpConfirmRemoteZip(file);
          return;
        }
        if (kpIsRemoteHost() && kpIsImageAttachment(file)) {
          kpConfirmRemoteImage(file);
          return;
        }
        if (kpIsRemoteHost() && !kpIsImageAttachment(file) && !kpIsTextAttachment(file)) {
          kpAttachmentEvent("异地机器不上传原始材料;如需处理请在该机器上用 📁 本地目录授权,或导出为文本再试", true);
          return;
        }
        kpUploadRawAttachment(file).catch(function () {});
      }
      if (input && kind === "chat") {
        input.addEventListener("paste", function (e) {
          var items = e.clipboardData && e.clipboardData.items ? e.clipboardData.items : [];
          for (var i = 0; i < items.length; i++) {
            if (items[i].kind === "file") {
              var f = items[i].getAsFile(); if (f) { e.preventDefault(); uploadAttachment(f); }
            }
          }
        });
        win.addEventListener("dragover", function (e) { e.preventDefault(); });
        win.addEventListener("drop", function (e) {
          var fs = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [];
          if (!fs.length) return;
          e.preventDefault();
          for (var i = 0; i < fs.length; i++) { uploadAttachment(fs[i]); }
        });
      }
      function setState(s) { if (stateEl) stateEl.textContent = s; }
      var stopConfirmState = { until: 0, timer: null };
      function confirmStop(label) {
        stopConfirmState = kpStopConfirm(stopConfirmState, Date.now(), setState, function () { abort(false); }, label, function (fn, ms) { return setTimeout(function () { if (cur) fn(); }, ms); }, clearTimeout);
      }
      function setEditingLast(active) {
        editingLast = active === true;
        if (input) input.setAttribute("placeholder", editingLast ? "编辑尾轮 — 回车重发" : (chatMode === "plan" ? planChatPlaceholder : normalChatPlaceholder));
        if (sendBtn && !cur) sendBtn.textContent = editingLast ? "重发" : "\\u25B6 \\u53D1\\u9001";
      }
      function setRunning(r) {
        if (stopConfirmState.timer != null) clearTimeout(stopConfirmState.timer); stopConfirmState = { until: 0, timer: null };
        setState(r ? "运行中" : "就绪");
        if (sendBtn) {
          sendBtn.textContent = r ? "\\u23F9 \\u505C\\u6B62" : editingLast ? "重发" : "\\u25B6 \\u53D1\\u9001";
          sendBtn.classList.toggle("kp-stop", r);
          if (r) sendBtn.setAttribute("title", "终止本轮生成(排队消息会保留)");
          else sendBtn.removeAttribute("title");
        }
      }
      function drainQueue() {
        if (!messageQueue || cur || !messageQueue.length) return;
        var next = messageQueue.shift();
        renderQueue();
        send(next);
      }
      function endRun(aborted, continueQueue, stoppedByUser) {
        if (curFin) { curFin(aborted, stoppedByUser); curFin = null; }
        cur = null;
        setRunning(false);
        if (continueQueue !== false) setTimeout(drainQueue, 0);
      }
      function abandonReconnect() {
        if (!cur || !cur.isReconnecting || !cur.isReconnecting()) return false;
        var reconnectingStream = cur;
        try { reconnectingStream.close(); } catch (_e) {}
        var i = wbStreams.indexOf(reconnectingStream); if (i >= 0) wbStreams.splice(i, 1);
        endRun(true, false, false);
        return true;
      }
      function abort(alsoClearQueue) {
        if (!cur) return;
        if (alsoClearQueue) clearQueue();
        var convId = win.getAttribute("data-conv") || "";
        if (convId) {
          var wsId = currentProjectId();
          fetch("/api/workspace/" + encodeURIComponent(wsId) + "/chat/stop?conv=" + encodeURIComponent(convId), { method: "POST" }).catch(function () {});
        }
        try { cur.close(); } catch (_e) {}
        var i = wbStreams.indexOf(cur); if (i >= 0) wbStreams.splice(i, 1);
        endRun(true, !alsoClearQueue, true);
      }
      function run(url, label, requestBody, retryDraftKey, retryDraftValue) {
        if (cur && !abandonReconnect()) return;
        var runInfo = {
          url: url,
          label: label,
          requestBody: requestBody,
          draftKey: retryDraftKey || activeDraftKey,
          draftValue: retryDraftValue == null && requestBody ? requestBody.msg : retryDraftValue
        };
        if (kind === "chat") win.__kpLastRun = runInfo;
        log.querySelectorAll("[data-kp-retry]").forEach(function (button) { button.disabled = true; });
        setRunning(true);
        curFin = startActivity(log, label);
        cur = openStream(url, log, toks, function (errored) { endRun(!!errored);
          var conversationReloaded = arguments.length > 1 && arguments[1];
          if (kind === "chat") {
            refreshConversations();
            if (!errored) {
              clearCompletedDraft(runInfo);
              if (!conversationReloaded) reloadConversationWindow(win);
            }
          }
        }, requestBody);
      }
      function send(queuedText, forceReplaceLast) {
        hideMenu();
        var fromQueue = typeof queuedText === "string";
        var text = fromQueue ? queuedText : (input && input.value ? String(input.value).trim() : "");
        var replacing = forceReplaceLast === true || (!fromQueue && editingLast);
        if (text === "/stop") { if (!fromQueue) { input.value = ""; input.style.height = ""; } abort(true); return; }
        if (cur && (!text && !pendingImgs.length || !abandonReconnect())) return; // 生成中先停止再发;重连中则放弃旧流
        if (!text && !pendingImgs.length) return;
        var sentDraftKey = activeDraftKey;
        if (kind === "chat" && !fromQueue) saveDraftSnapshot(text);
        var wsId = currentProjectId();
        var clip = pendingImgs.length ? ' <span class="kp-clip">\\uD83D\\uDCCE' + pendingImgs.length + '</span>' : "";
        if (!replacing) appendLine(log, '<div class="kp-chat-me" data-copy="' + escAttr(text) + '">' + esc(text) + clip + "</div>");
        if (!fromQueue) { input.value = ""; input.style.height = ""; }
        if (replacing) setEditingLast(false);
        if (kind === "task") {
          var tmodel = modelEl && modelEl.value ? modelEl.value : "claude-opus-5";
          run("/api/workspace/" + encodeURIComponent(wsId) + "/events?msg=" + encodeURIComponent(text) + "&model=" + encodeURIComponent(tmodel), "任务");
          return;
        }
        if (text.charAt(0) === "/" && !replacing) {
          var clientCommand = /^\\/(\\w+)(?:\\s+([\\s\\S]*))?$/.exec(text);
          var clientName = clientCommand ? clientCommand[1].toLowerCase() : "";
          var clientArg = clientCommand ? String(clientCommand[2] || "").trim() : "";
          if (clientName === "web") {
            if (clientArg !== "on" && clientArg !== "off") { appendLine(log, '<div class="kp-ev kp-ev-error">用法:/web on|off</div>'); return; }
            webOn = clientArg === "on";
            appendLine(log, '<div class="kp-ev kp-ev-done">联网搜索:' + (webOn ? "开" : "关") + '</div>');
            clearCompletedDraft({ draftKey: sentDraftKey, draftValue: text });
            return;
          }
          if (clientName === "open") {
            if (!clientArg) { appendLine(log, '<div class="kp-ev kp-ev-error">用法:/open 相对路径(如 docs/x.html)</div>'); return; }
            var openUrl = "/api/file?path=" + encodeURIComponent(clientArg);
            appendLine(log, '<div class="kp-ev">↗ <a href="' + openUrl + '" target="_blank" rel="noopener">打开 ' + esc(clientArg) + '</a> · <a href="' + openUrl + '&disp=download">⬇ 下载</a></div>');
            clearCompletedDraft({ draftKey: sentDraftKey, draftValue: text });
            return;
          }
          if (clientName === "files") {
            fetch("/api/files?dir=" + encodeURIComponent(clientArg || ".")).then(function (r) { return r.json(); }).then(function (j) {
              if (!j || !j.ok) { appendLine(log, '<div class="kp-ev kp-ev-error">打不开目录:' + esc((j && j.error) || "") + '</div>'); return; }
              var rows = (j.entries || []).map(function (e) {
                if (e.dir) return '📁 <a href="#" data-files="' + escAttr(e.path) + '">' + esc(e.name) + '/</a>';
                var fileUrl = "/api/file?path=" + encodeURIComponent(e.path);
                return '<a href="' + fileUrl + '" target="_blank" rel="noopener">' + esc(e.name) + '</a> <a href="' + fileUrl + '&disp=download" title="下载">⬇</a>';
              }).join("<br>");
              appendLine(log, '<div class="kp-ev"><b>' + esc(j.dir) + '/</b><br>' + (rows || "(空)") + '</div>');
              clearCompletedDraft({ draftKey: sentDraftKey, draftValue: text });
            }).catch(function () {});
            return;
          }
        }
        var model = modelEl && modelEl.value ? modelEl.value : "claude-opus-5";
        var label = modelEl && modelEl.options[modelEl.selectedIndex] ? modelEl.options[modelEl.selectedIndex].text : model;
        var imgQ = pendingImgs.length ? "&images=" + encodeURIComponent(pendingImgs.map(function (im) { return im.id; }).join(",")) : "";
        var convId = win.getAttribute("data-conv") || "";
        pendingImgs = []; renderChips();
        var requestBody = replacing ? { mode: chatMode, replaceLast: true } : { mode: chatMode };
        requestBody.workMode = typeof kpCurrentWorkMode === "function" ? kpCurrentWorkMode() : "full";
        requestBody.sensitive = win.getAttribute("data-sensitive") === "true";
        requestBody.msg = text;
        run("/api/workspace/" + encodeURIComponent(wsId) + "/chat?" + (convId ? "conv=" + encodeURIComponent(convId) : "session=" + encodeURIComponent(id)) + "&model=" + encodeURIComponent(model) + imgQ + (webOn ? "&web=1" : ""), label + (webOn ? " · 联网" : ""), requestBody, sentDraftKey, text);
      }
      // ── 本地目录桥(localfs):授权目录 + 轮询执行 agent 的文件操作(仅 Chromium) ──
      var localfsChip = win.querySelector(".kp-localfs-access");
      var localfsDir = null;
      var localfsRegisteredAt = 0;
      var localfsPendingHandle = null;
      var localfsTimer = null;
      var localfsEpoch = 0;
      function localfsCurrentConversation() { return win.getAttribute("data-conv") || ""; }
      function localfsSetChip(state, html) { if (!localfsChip) return; localfsChip.className = "kp-localfs-chip" + (state ? " " + state : ""); if (html != null) localfsChip.innerHTML = html; }
      function localfsShowUnbound(hasOtherConversation) {
        if (localfsChip) localfsChip.setAttribute("title", hasOtherConversation ? "其他会话绑定过目录,本会话需单独授权" : "授权一个本地目录，让对话里的 agent 读写其中文件");
        localfsSetChip("", "\\uD83D\\uDCC1 \\u6388\\u6743\\u672C\\u5730\\u76EE\\u5F55");
      }
      function localfsIdle() { localfsSetChip("on", "\\uD83D\\uDCC1 " + esc(localfsDir ? localfsDir.name : "") + (localfsDir ? ' <span class="kp-localfs-host">@' + esc(location.host) + '</span>' : '') + " <span class=\\"x\\" data-localfs-clear=\\"1\\" title=\\"\\u89E3\\u9664\\u6388\\u6743\\">\\u2715</span>"); }
      function localfsAuthorizationLabel(h) {
        var username = localfsCurrentUsername();
        return username ? "已授权本地目录:" + h.name + " @" + location.host + " · 账号 " + username + "(仅该账号的会话可用)" : "";
      }
      function localfsAdoptHandle(h, epoch) {
        if (epoch !== localfsEpoch) return;
        var label = localfsAuthorizationLabel(h);
        if (!label) { localfsShowUnbound(false); localfsPendingHandle = null; return; }
        localfsDir = h;
        if (localfsChip) localfsChip.setAttribute("title", label);
        localfsIdle();
        localfsStart();
        localfsPendingHandle = null;
      }
      async function localfsResolveDir(segs, create, rootDir) { var d = rootDir; for (var i = 0; i < segs.length; i++) { if (segs[i] && segs[i] !== ".") d = await d.getDirectoryHandle(segs[i], { create: !!create }); } return d; }
      async function localfsWalk(d, prefix, out) { for await (var en of d.values()) { var p = prefix + en.name; if (en.kind === "directory") { out.push(p + "/"); await localfsWalk(en, p + "/", out); } else { out.push(p); } } return out; }
      async function localfsExec(op, localfsDir) {
        var textReadLimit = 2097152; // 2 * 1024 * 1024
        var binaryReadLimit = 5242880; // 5 * 1024 * 1024
        var writeLimit = 10485760; // 10 * 1024 * 1024
        function localfsNestWarn(path) {
          var first = String(path || "").split("/").filter(Boolean)[0] || "";
          if (localfsDir && first === localfsDir.name) return " \\u26A0\\uFE0F \\u540C\\u540D\\u5D4C\\u5957\\u8B66\\u544A:\\u8DEF\\u5F84\\u9996\\u6BB5\\u4E0E\\u6388\\u6743\\u6839\\u76EE\\u5F55\\u540C\\u540D";
          return "";
        }
        async function localfsIsBinary(file, name) {
          if (/\\.svg$/i.test(name)) return false;
          if (/\\.(png|jpg|jpeg|gif|webp|pdf|docx|xlsx|pptx|zip|gz|tar|bin|dylib|so|class)$/i.test(name)) return true;
          var head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
          for (var i = 0; i < head.length; i++) { if (head[i] === 0) return true; }
          return false;
        }
        async function localfsBase64(file) {
          var bytes = new Uint8Array(await file.arrayBuffer());
          var encoded = [];
          for (var i = 0; i < bytes.length; i += 24576) {
            var chunk = bytes.subarray(i, Math.min(i + 24576, bytes.length));
            var binary = "";
            for (var j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
            encoded.push(btoa(binary));
          }
          return encoded.join("");
        }
        function localfsError(e) {
          var name = e && e.name ? String(e.name) : "Error";
          var message = e && e.message ? String(e.message) : String(e);
          if (name === "NotFoundError") return { ok: false, error: "路径不存在: " + String(op.path || "") };
          if (name === "NotAllowedError" || name === "SecurityError") {
            localfsSetChip("error", "⚠️ 目录授权已失效,请点 📁 重新授权");
            return { ok: false, error: "目录授权已失效,请点 📁 重新授权", chipError: true };
          }
          if (name === "TypeMismatchError") return { ok: false, error: String(op.path || "") + " 是目录不是文件(或相反)" };
          return { ok: false, error: name + ": " + message };
        }
        try {
          var segs = String(op.path || "").split("/").filter(Boolean);
          if (op.kind === "list") { var ld = await localfsResolveDir(segs, false, localfsDir); var ns = []; if (op.recursive) { await localfsWalk(ld, "", ns); } else { for await (var en of ld.values()) { ns.push(en.kind === "directory" ? en.name + "/" : en.name); } } return { ok: true, data: JSON.stringify(ns) }; }
          if (op.kind === "mkdir") { await localfsResolveDir(segs, true, localfsDir); return { ok: true, data: "MKDIR " + localfsDir.name + "/" + op.path + localfsNestWarn(op.path) }; }
          var name = segs.pop();
          if (!name) return { ok: false, error: "\\u9700\\u8981\\u6587\\u4EF6\\u8DEF\\u5F84" };
          if (op.kind === "write" && new Blob([op.content || ""]).size > writeLimit) return { ok: false, error: "写入内容 " + new Blob([op.content || ""]).size + " bytes 超过 10MB 写入上限" };
          var dir = await localfsResolveDir(segs, op.kind === "write", localfsDir);
          if (op.kind === "read") {
            var file = await (await dir.getFileHandle(name)).getFile();
            if (kpOfficeName(name)) {
              try {
                return { ok: true, data: await kpOfficeExtract(file, name) };
              } catch (_officeError) {
                // Keep damaged or encrypted Office files on the original binary path.
              }
            }
            if (kpPdfName(name)) {
              try {
                return { ok: true, data: await kpPdfExtract(file, name) };
              } catch (_pdfError) {
                // Keep damaged or encrypted PDF files on the original binary path.
              }
            }
            var isBinary = await localfsIsBinary(file, name);
            if (isBinary) {
              if (file.size > binaryReadLimit) return { ok: false, error: "二进制文件 " + file.size + " bytes 超过 5MB 读取上限" };
              return { ok: true, data: await localfsBase64(file), encoding: "base64" };
            }
            if (file.size > textReadLimit) return { ok: true, data: await file.slice(0, textReadLimit).text() + "\\n…[截断:文件 " + file.size + " bytes,已返回前 2MB]", truncated: true };
            return { ok: true, data: await file.text() };
          }
          if (op.kind === "write") { var wh = await dir.getFileHandle(name, { create: true }); var w = await wh.createWritable(); await w.write(op.content || ""); await w.close(); return { ok: true, data: "WROTE " + localfsDir.name + "/" + op.path + " (" + op.content.length + " chars)" + localfsNestWarn(op.path) }; }
          if (op.kind === "stat") { try { var sf = await (await dir.getFileHandle(name)).getFile(); return { ok: true, data: JSON.stringify({ type: "file", size: sf.size }) }; } catch (_e) { await dir.getDirectoryHandle(name); return { ok: true, data: JSON.stringify({ type: "dir" }) }; } }
          if (op.kind === "delete") { await dir.removeEntry(name, { recursive: true }); return { ok: true }; }
          return { ok: false, error: "\\u672A\\u77E5\\u64CD\\u4F5C " + op.kind };
        } catch (e) {
          return localfsError(e);
        }
      }
      function localfsResultPayload(res) {
        var payload = Object.assign({}, res);
        delete payload.chipError;
        if (res && res.ok && (res.encoding || res.truncated)) {
          var metadata = {};
          if (res.encoding) metadata.encoding = res.encoding;
          if (res.truncated) metadata.truncated = true;
          payload.error = "__KP_LOCALFS_META__" + JSON.stringify(metadata);
        }
        return payload;
      }
      function localfsActionLinks(op) {
        try {
          if (op.kind !== "write" || typeof op.content !== "string") return "";
          var nm = String(op.path || "file").split("/").pop() || "file";
          var isHtml = /\\.html?$/i.test(nm);
          var blob = new Blob([op.content], { type: isHtml ? "text/html" : "text/plain;charset=utf-8" });
          var u = URL.createObjectURL(blob);
          return ' <a href="' + u + '" target="_blank" rel="noopener">\\uD83D\\uDC41 \\u9884\\u89C8</a> <a href="' + u + '" download="' + escAttr(nm) + '">\\u2B07 \\u4E0B\\u8F7D\\u526F\\u672C</a>';
        } catch (_e) { return ""; }
      }
      function localfsRegister(conv) {
        if (!conv || !localfsDir) return;
        var now = Date.now();
        if (now - localfsRegisteredAt < 60000) return;
        localfsRegisteredAt = now;
        fetch("/api/localfs/authorize?conv=" + encodeURIComponent(conv), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: localfsClientId(), dirName: localfsDir.name, origin: location.host }) }).catch(function () {});
      }
      function localfsActivityPath(op, localfsDir) { return (localfsDir ? localfsDir.name + "/" : "") + (op.path || ""); }
      function localfsPoll() {
        var conv = win.getAttribute("data-conv");
        if (!conv || !localfsDir) return;
        var epoch = localfsEpoch;
        var opDir = localfsDir;
        localfsRegister(conv);
        fetch("/api/localfs/poll?conv=" + encodeURIComponent(conv) + "&clientId=" + encodeURIComponent(localfsClientId())).then(function (r) {
          if (epoch !== localfsEpoch || conv !== localfsCurrentConversation()) return null;
          if (r.status === 403) {
            if (localfsTimer) { clearInterval(localfsTimer); localfsTimer = null; }
            localfsSetChip("warn", "\\u26A0\\uFE0F \\u8BE5\\u76EE\\u5F55\\u5DF2\\u5728\\u53E6\\u4E00\\u6765\\u6E90/\\u673A\\u5668\\u6388\\u6743\\uFF0C\\u672C\\u7AEF\\u4E0D\\u518D\\u63A5\\u7BA1");
            return null;
          }
          return r.status === 200 ? r.json() : null;
        }).then(function (op) {
          if (!op || epoch !== localfsEpoch || conv !== localfsCurrentConversation()) return;
          var lbl = ({ read: "\\uD83D\\uDCD6 \\u8BFB\\u53D6", write: "\\u270F\\uFE0F \\u5199\\u5165", list: "\\uD83D\\uDCC2 \\u5217\\u76EE\\u5F55", stat: "\\u2139\\uFE0F \\u67E5\\u770B", "delete": "\\uD83D\\uDDD1 \\u5220\\u9664", mkdir: "\\uD83D\\uDCC1 \\u5EFA\\u76EE\\u5F55" })[op.kind] || op.kind;
          appendLine(log, '<div class="kp-ev kp-localfs-ev">' + lbl + ' ' + esc(localfsActivityPath(op, opDir)) + ' <span class="kp-localfs-host">@' + esc(location.host) + '</span></div>');
          localfsSetChip("busy", "\\u27F3 " + lbl + "\\u2026");
          localfsExec(op, opDir).then(function (res) { res.opId = op.opId; if (res.ok === undefined) res.ok = true; return res; }, function (err) { return { opId: op.opId, ok: false, error: String((err && err.message) || err) }; }).then(function (res) {
            if (op.kind === "write" && res && res.ok !== false) {
              appendLine(log, '<div class="kp-ev kp-ev-done">\\u5DF2\\u5199\\u5165 ' + esc(localfsActivityPath(op, opDir)) + ' <span class="kp-localfs-host">@' + esc(location.host) + '</span>' + localfsActionLinks(op) + '</div>');
            }
            return fetch("/api/localfs/result?conv=" + encodeURIComponent(conv), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ clientId: localfsClientId() }, localfsResultPayload(res))) }).then(function () { return !!res.chipError; });
          }).then(function (keepError) { if (epoch === localfsEpoch && !keepError) localfsIdle(); }, function () { if (epoch === localfsEpoch) localfsIdle(); });
        }).catch(function () {});
      }
      function localfsStart() { if (localfsTimer) return; localfsTimer = setInterval(function () { if (!document.body.contains(win)) { clearInterval(localfsTimer); localfsTimer = null; return; } localfsPoll(); }, 1500); }
      function localfsResetForConversation() {
        localfsEpoch++;
        localfsDir = null;
        localfsRegisteredAt = 0;
        localfsPendingHandle = null;
        if (localfsTimer) { clearInterval(localfsTimer); localfsTimer = null; }
        localfsShowUnbound(false);
      }
      function localfsRestoreHandle(h, epoch) {
        localfsPendingHandle = h;
        try {
          if (h.queryPermission) {
            h.queryPermission({ mode: "readwrite" }).then(function (p) {
              if (epoch !== localfsEpoch || localfsPendingHandle !== h) return;
              if (p === "granted") { localfsAdoptHandle(h, epoch); return; }
              localfsSetChip("restore", "\\uD83D\\uDCC1 \\u6062\\u590D " + esc(h.name));
            }, function () {
              if (epoch === localfsEpoch && localfsPendingHandle === h) localfsSetChip("restore", "\\uD83D\\uDCC1 \\u6062\\u590D " + esc(h.name));
            });
            return;
          }
        } catch (_e) {}
        if (epoch === localfsEpoch && localfsPendingHandle === h) localfsSetChip("restore", "\\uD83D\\uDCC1 \\u6062\\u590D " + esc(h.name));
      }
      function localfsReloadForConv() {
        localfsResetForConversation();
        var conv = localfsCurrentConversation();
        var epoch = localfsEpoch;
        localfsLoadHandle(conv, function (h, hasOtherConversation) {
          if (epoch !== localfsEpoch || conv !== localfsCurrentConversation()) return;
          if (!h) { localfsShowUnbound(hasOtherConversation); return; }
          localfsRestoreHandle(h, epoch);
        });
      }
      function localfsPick(onAuthorized) {
        if (!window.showDirectoryPicker) { appendLine(log, '<div class="kp-ev kp-ev-error">此浏览器不支持本地目录授权——手机/平板浏览器均不支持，请改用桌面版 Chrome 或 Edge 打开本页再授权</div>'); return; }
        var conv = localfsCurrentConversation();
        var epoch = localfsEpoch;
        window.showDirectoryPicker({ mode: "readwrite" }).then(function (h) {
          if (epoch !== localfsEpoch || conv !== localfsCurrentConversation()) return;
          var label = localfsAuthorizationLabel(h);
          if (!label) { localfsShowUnbound(false); return; }
          localfsRegisteredAt = 0;
          localfsSaveHandle(h, conv);
          localfsAdoptHandle(h, epoch);
          appendLine(log, '<div class="kp-ev kp-ev-done">' + esc(label) + ' (本目录在你当前浏览器所在机器上;对话里可让我读写其中文件)</div>');
          if (typeof onAuthorized === "function") onAuthorized(h);
        }).catch(function () {});
      }
      if (localfsChip) localfsChip.addEventListener("click", function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute("data-localfs-clear")) { e.stopPropagation(); var conv = localfsCurrentConversation(); localfsResetForConversation(); localfsForgetHandle(conv, localfsReloadForConv); return; }
        if (!localfsDir && localfsPendingHandle) {
          var h = localfsPendingHandle;
          var epoch = localfsEpoch;
          try {
            if (h.requestPermission) {
              h.requestPermission({ mode: "readwrite" }).then(function (p) {
                if (epoch !== localfsEpoch || localfsPendingHandle !== h) return;
                if (p === "granted") { localfsAdoptHandle(h, epoch); return; }
                localfsPick();
              }, function () { localfsPick(); });
              return;
            }
          } catch (_e) {}
          localfsPick();
          return;
        }
        localfsPick();
      });
      if (localfsChip) {
        win.addEventListener("kp:conversation-changed", localfsReloadForConv);
        localfsReloadForConv();
      }
      if (sendBtn) sendBtn.addEventListener("click", function () { if (cur) confirmStop("再点一次停止本轮"); else send(); });
      if (input) input.addEventListener("keydown", function (e) {
        // 输入法组合态（中文选词）的回车是在确认候选词，不是发送；keyCode 229 兜底老 WebKit。
        if (e.isComposing || e.keyCode === 229) return;
        var menuOpen = cmdMenu && cmdMenu.style.display === "block" && cmdList.length;
        if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault(); cmdSel = (cmdSel + (e.key === "ArrowDown" ? 1 : cmdList.length - 1)) % cmdList.length; renderMenu(); return;
        }
        if (menuOpen && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); pickCmd(cmdSel); return; }
        if (menuOpen && e.key === "Escape") { e.preventDefault(); hideMenu(); return; }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (cur && cur.isReconnecting && cur.isReconnecting()) send();
          else if (!enqueueCurrentMessage()) send();
        }
        else if (e.key === "Escape") { e.preventDefault(); if (cur) confirmStop("再按一次 Esc 停止本轮"); else input.blur(); }
      });
      // 自动增高 + / 命令菜单
      if (input) input.addEventListener("input", function () {
        resizeInput();
        scheduleDraft();
        cmdSel = 0; renderMenu();
      });
      if (input && kind === "chat") input.addEventListener("blur", persistDraft);
      // 人工门按钮(任务流里)
      log.addEventListener("click", function (event) {
        var t = event.target;
        var retry = t && t.closest ? t.closest("[data-kp-retry]") : null;
        if (retry) {
          event.preventDefault();
          var lastRun = win.__kpLastRun;
          if (!lastRun || cur && (!cur.isReconnecting || !cur.isReconnecting())) { retry.disabled = true; return; }
          retry.disabled = true;
          run(lastRun.url, lastRun.label, lastRun.requestBody, lastRun.draftKey, lastRun.draftValue);
          return;
        }
        var backlog = t && t.closest ? t.closest("[data-loop-backlog]") : null;
        if (backlog) {
          event.preventDefault();
          window.location.hash = "#/evolution";
          return;
        }
        var edit = t && t.closest ? t.closest("[data-chat-edit]") : null;
        if (edit) {
          event.preventDefault();
          if (cur || !input) return;
          input.value = edit.getAttribute("data-user-text") || "";
          setEditingLast(true);
          resizeInput();
          scheduleDraft();
          input.focus();
          return;
        }
        var regenerate = t && t.closest ? t.closest("[data-chat-regenerate]") : null;
        if (regenerate) {
          event.preventDefault();
          if (cur) return;
          send(regenerate.getAttribute("data-user-text") || "", true);
          return;
        }
        var quote = t && t.closest ? t.closest("[data-chat-quote]") : null;
        if (quote) {
          event.preventDefault();
          var message = quote.closest ? quote.closest(".kp-msg") : null;
          var messageText = message ? message.getAttribute("data-copy") || "" : "";
          kpInsertQuotedText(input, messageText.slice(0, 300));
          resizeInput();
          scheduleDraft();
          return;
        }
        var df = t && t.closest ? t.closest("[data-files]") : null;
        if (df) { event.preventDefault(); input.value = "/files " + df.getAttribute("data-files"); send(); return; }
        var yes = t && t.closest ? t.closest("[data-gate-yes]") : null;
        var no = t && t.closest ? t.closest("[data-gate-no]") : null;
        var btn = yes || no; if (!btn) return;
        event.preventDefault();
        var gateId = yes ? btn.getAttribute("data-gate-yes") : btn.getAttribute("data-gate-no");
        fetch("/api/workspace/" + encodeURIComponent(currentProjectId()) + "/gate", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ gateId: gateId, decision: yes ? "yes" : "no" })
        }).catch(function () {});
      });
      function quickFill(text) {
        if (!input) return;
        input.value = text;
        resizeInput();
        scheduleDraft();
        input.focus();
      }
      win.addEventListener("click", function (event) {
        var t = event.target;
        var authorize = t && t.closest ? t.closest("[data-kp-quick-authorize]") : null;
        if (authorize) { event.preventDefault(); localfsPick(); return; }
        var example = t && t.closest ? t.closest("[data-kp-example]") : null;
        if (!example) return;
        event.preventDefault();
        if (!input) return;
        var template = example.getAttribute("data-kp-example") || "";
        // 需要目录上下文的快捷项:已授权直接点名目录;未授权先弹选择器,授权成功再回填,不把 {dir} 占位漏给用户。
        if (example.getAttribute("data-kp-needs-dir")) {
          if (localfsDir) { quickFill(template.split("{dir}").join(localfsDir.name)); return; }
          localfsPick(function (h) { quickFill(template.split("{dir}").join(h && h.name ? h.name : "")); });
          return;
        }
        quickFill(template);
      });
      win.querySelector(".kp-win-close").addEventListener("click", function () {
        stopSpeech();
        disposeWindowSearch();
        document.removeEventListener("focusin", deactivateWindowWhenOutside);
        document.removeEventListener("pointerdown", deactivateWindowWhenOutside);
        persistDraftOnExit();
        if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
        if (kind === "chat") window.removeEventListener("beforeunload", persistDraftOnExit);
        if (cur) { try { cur.close(); } catch (_e) {} }
        win.remove();
      });
      if (input) input.focus();
    }

    function addWindow(kind, conversation) {
      var existingWindows = winHost.querySelectorAll(".kp-win");
      if (existingWindows.length >= KP_MAX_WINDOWS) {
        var lastWindow = existingWindows[existingWindows.length - 1];
        appendLine(lastWindow.querySelector(".kp-win-log"), '<div class="kp-ev kp-ev-error">最多同时打开 12 个窗口,请先关闭一个</div>');
        if (lastWindow.scrollIntoView) lastWindow.scrollIntoView({ block: "nearest" });
        return lastWindow;
      }
      var id = uid();
      winHost.insertAdjacentHTML("beforeend", winHtml(id, kind, conversation));
      var win = winHost.querySelector('[data-win="' + id + '"]');
      if (conversation && conversation.id) win.setAttribute("data-conv", conversation.id);
      applyConversationSensitive(win, conversation ? conversation.sensitive === true : kind === "chat" && kpIsRemoteHost());
      wireWindow(win);
      if (conversation && conversation.model) {
        var m = win.querySelector(".kp-win-model");
        if (m) kpApplyConvModel(m, conversation.model);
      }
      if (conversation) {
        var ttl = win.querySelector(".kp-ttl-select");
        var ttlValue = typeof conversation.ttlDays === "number" ? String(conversation.ttlDays) : "";
        win.setAttribute("data-ttl-days", ttlValue);
        if (ttl) ttl.value = ttlValue;
      }
      if (!conversation && kind === "chat" && kpIsRemoteHost()) {
        appendLine(win.querySelector(".kp-win-log"), '<div class="kp-ev kp-ev-done">异地机器:本会话默认敏感,内容不进知识库(点 🔒 可关)</div>');
      }
      return win;
    }
    var nc = document.getElementById("kp-new-chat");
    var nt = document.getElementById("kp-new-task");
    if (nc) nc.addEventListener("click", function () { if (this.disabled) return; this.disabled=true; var b = this; setTimeout(function () { b.disabled=false; }, 800); addWindow("chat"); });
    if (nt) nt.addEventListener("click", function () { if (this.disabled) return; this.disabled=true; var b = this; setTimeout(function () { b.disabled=false; }, 800); addWindow("task"); });
    if (convArchiveToggle) convArchiveToggle.addEventListener("click", function () {
      conversationArchiveView = !conversationArchiveView;
      convArchiveToggle.textContent = conversationArchiveView ? "返回" : "归档";
      convArchiveToggle.setAttribute("aria-label", conversationArchiveView ? "返回活跃会话" : "查看归档会话");
      if (convSearch) {
        convSearch.value = "";
        convSearch.disabled = conversationArchiveView;
      }
      refreshConversations();
    });
    if (convList) convList.addEventListener("click", function (event) {
      var fork = event.target && event.target.closest ? event.target.closest("[data-conv-fork]") : null;
      var pin = event.target && event.target.closest ? event.target.closest("[data-conv-pin]") : null;
      var exp = event.target && event.target.closest ? event.target.closest(".kp-conv-exp") : null;
      var del = event.target && event.target.closest ? event.target.closest(".kp-conv-del") : null;
      var restore = event.target && event.target.closest ? event.target.closest("[data-conv-restore]") : null;
      var purge = event.target && event.target.closest ? event.target.closest("[data-conv-purge]") : null;
      var item = event.target && event.target.closest ? event.target.closest(".kp-conv-item") : null;
      if (!item) return;
      var id = item.getAttribute("data-conv") || "";
      if (!pin && item.getAttribute("data-pin-revealed") === "true") {
        event.preventDefault();
        item.removeAttribute("data-pin-revealed");
        return;
      }
      if (restore) {
        event.preventDefault();
        event.stopPropagation();
        fetch("/api/conversations/" + encodeURIComponent(id), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "restore" })
        }).then(function (r) {
          if (!r.ok) throw new Error("restore failed");
          conversationArchiveView = false;
          if (convArchiveToggle) {
            convArchiveToggle.textContent = "归档";
            convArchiveToggle.setAttribute("aria-label", "查看归档会话");
          }
          if (convSearch) convSearch.disabled = false;
          return refreshConversations();
        }).catch(function () {
          restore.textContent = "恢复失败";
          setTimeout(function () { restore.textContent = "恢复"; }, 3000);
        });
        return;
      }
      if (purge) {
        event.preventDefault();
        event.stopPropagation();
        if (purge.getAttribute("data-armed") !== "1") {
          purge.setAttribute("data-armed", "1");
          purge.textContent = "确认删除?";
          setTimeout(function () {
            if (purge.getAttribute("data-armed") === "1") {
              purge.setAttribute("data-armed", "0");
              purge.textContent = "彻底删除";
            }
          }, 3000);
          return;
        }
        purge.setAttribute("data-armed", "2");
        purge.disabled = true;
        fetch("/api/conversations/" + encodeURIComponent(id), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "purge" })
        }).then(function (r) {
          if (!r.ok) throw new Error("purge failed");
          return refreshConversations();
        }).catch(function () {
          purge.disabled = false;
          purge.setAttribute("data-armed", "0");
          purge.textContent = "删除失败";
          setTimeout(function () { purge.textContent = "彻底删除"; }, 3000);
        });
        return;
      }
      if (fork) {
        event.preventDefault();
        event.stopPropagation();
        fetch("/api/conversations/" + encodeURIComponent(id), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "fork" })
        }).then(function (r) {
          if (!r.ok) throw new Error("fork failed");
          return r.json();
        }).then(function (conversation) {
          if (!conversation || !conversation.id) return;
          return refreshConversations().then(function () { openConversation(conversation.id, conversation.title); });
        }).catch(function () {});
        return;
      }
      if (pin) {
        event.preventDefault();
        event.stopPropagation();
        var nextPinned = pin.getAttribute("aria-pressed") !== "true";
        pin.disabled = true;
        fetch("/api/conversations/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pinned: nextPinned })
        }).then(function (r) {
          if (!r.ok) throw new Error("pinned PATCH failed");
          var q = convSearch ? convSearch.value.trim() : "";
          return q.length >= 2 ? searchConversations(q) : refreshConversations();
        }).catch(function () {
          pin.disabled = false;
          pin.textContent = "!";
          setTimeout(function () { pin.textContent = "📌"; }, 2000);
        });
        return;
      }
      if (exp) {
        event.preventDefault();
        event.stopPropagation();
        fetch("/api/conversations/" + encodeURIComponent(id) + "?format=md").then(function (r) { return r.json(); }).then(function (d) {
          if (!d || !d.content) return;
          var b = new Blob([d.content], { type: "text/markdown;charset=utf-8" });
          var u = URL.createObjectURL(b);
          var a = document.createElement("a");
          a.href = u;
          a.download = d.filename || (id + ".md");
          document.body.appendChild(a);
          a.click();
          if (a.parentNode) a.parentNode.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
        }).catch(function () {});
        return;
      }
      if (del) {
        event.preventDefault();
        event.stopPropagation();
        del.disabled = true;
        fetch("/api/conversations/" + encodeURIComponent(id), { method: "DELETE" }).then(function (r) {
          if (!r.ok) throw new Error("delete failed");
          var openWindows = winHost.querySelectorAll(".kp-win[data-conv]");
          for (var i = 0; i < openWindows.length; i++) {
            if (openWindows[i].getAttribute("data-conv") !== id) continue;
            var closeButton = openWindows[i].querySelector(".kp-win-close");
            if (closeButton) closeButton.click();
          }
          return refreshConversations();
        }).catch(function () {
          del.disabled = false;
          del.textContent = "删除失败";
          setTimeout(function () { del.textContent = "\\u2715"; }, 3000);
        });
        return;
      }
      if (conversationArchiveView) return;
      openConversation(id, item.getAttribute("title") || "");
    });
    if (convList) {
      var convPinTouchTimer = null;
      convList.addEventListener("touchstart", function (event) {
        var item = event.target && event.target.closest ? event.target.closest(".kp-conv-item") : null;
        var pin = item && item.querySelector ? item.querySelector("[data-conv-pin]") : null;
        if (!item || !pin) return;
        if (convPinTouchTimer) clearTimeout(convPinTouchTimer);
        convPinTouchTimer = setTimeout(function () {
          item.setAttribute("data-pin-revealed", "true");
        }, 450);
      }, { passive: true });
      ["touchmove", "touchend", "touchcancel"].forEach(function (name) {
        convList.addEventListener(name, function () {
          if (convPinTouchTimer) clearTimeout(convPinTouchTimer);
          convPinTouchTimer = null;
        }, { passive: true });
      });
    }
    if (convList) convList.addEventListener("dblclick", function (event) {
      if (conversationArchiveView) return;
      var item = event.target && event.target.closest ? event.target.closest(".kp-conv-item") : null;
      if (!item) return;
      var id = item.getAttribute("data-conv") || "";
      if (!id) return;
      var titleEl = item.querySelector(".ct");
      var cur = titleEl ? titleEl.textContent : "";
      var next = window.prompt("重命名会话", cur || "");
      if (next == null) return;
      next = String(next).trim();
      if (!next || next === cur) return;
      fetch("/api/conversations/" + encodeURIComponent(id), {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: next })
      }).then(function () { return refreshConversations(); }).catch(function () {});
    });
    if (convSearch) {
      var convSearchTimer = null;
      convSearch.addEventListener("input", function () {
        var q = this.value.trim();
        if (convSearchTimer) clearTimeout(convSearchTimer);
        conversationListRequest++;
        if (q.length < 2) {
          refreshConversations();
          return;
        }
        if (convList) convList.innerHTML = '<div class="kp-conv-empty">正在搜索…</div>';
        convSearchTimer = setTimeout(function () {
          searchConversations(q);
        }, 300);
      });
    }
    refreshConversations();
    addWindow("chat");
  }

`;
