'use client';

import { useState } from 'react';
import './globals.css';

interface FileResult {
  fileName: string;
  data: any;
  error?: string;
}

export default function Home() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    console.log(`Selected ${fileArray.length} files:`, fileArray.map(f => f.name)); // Debug log
    
    setSelectedFiles(prev => {
      // Prevent duplicates by checking file names
      const existingNames = prev.map(f => f.name);
      const newFiles = fileArray.filter(f => !existingNames.includes(f.name));
      return [...prev, ...newFiles];
    });
    setError(null);
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    console.log(`Dropped ${files.length} files`); // Debug log
    
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  };
  
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const processFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsProcessing(true);
    setError(null);
    setResults([]);

    const fileResults: FileResult[] = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setProcessingStatus(`Processing file ${i + 1} of ${selectedFiles.length}: ${file.name}`);

        try {
          // Convert file to base64
          const reader = new FileReader();
          const fileData = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          // Call API
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileData: fileData,
              fileName: file.name,
            }),
          });

          const data = await response.json();

          if (data.success) {
            fileResults.push({
              fileName: file.name,
              data: data.data,
            });
          } else {
            fileResults.push({
              fileName: file.name,
              data: null,
              error: data.error || 'Failed to analyze document',
            });
          }
        } catch (err) {
          fileResults.push({
            fileName: file.name,
            data: null,
            error: (err as Error).message || 'An error occurred',
          });
        }
      }

      setResults(fileResults);
      setIsProcessing(false);
      setProcessingStatus('');
    } catch (err) {
      setError((err as Error).message || 'An error occurred');
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const resetApp = () => {
    setSelectedFiles([]);
    setResults([]);
    setError(null);
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
  };

  const getTransactionTypeClass = (type: string) => {
    const typeMap: { [key: string]: string } = {
      'ACH Deposit': 'type-ach',
      'Wire Transfer': 'type-wire',
      'Zelle Transfer': 'type-zelle',
      'Venmo': 'type-transfer',
      'Cash App': 'type-transfer',
      'PayPal': 'type-transfer',
      'Bank Deposit': 'type-deposit',
      'Check Deposit': 'type-deposit',
      'Mobile Deposit': 'type-deposit',
      'Direct Deposit': 'type-ach',
      'Transfer In': 'type-transfer',
    };
    return typeMap[type] || 'type-deposit';
  };

  // Calculate combined totals
  const combinedTotals = results.reduce(
    (acc, result) => {
      if (result.data) {
        acc.totalIncome += result.data.totalIncome || 0;
        acc.totalTransactions += result.data.totalTransactions || 0;
      }
      return acc;
    },
    { totalIncome: 0, totalTransactions: 0 }
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-purple-900 p-5">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center text-white mb-8">
          <h1 className="text-5xl font-bold mb-3 drop-shadow-lg">💼 Income Verification Tool</h1>
          <p className="text-xl opacity-90">Upload multiple bank statements and get instant income analysis</p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-10">
          
          {/* Upload Section */}
          {!isProcessing && results.length === 0 && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => document.getElementById('fileInput')?.click()}
                className={`border-4 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all ${
                  selectedFiles.length > 0
                    ? 'border-green-500 bg-green-50'
                    : 'border-purple-400 bg-gradient-to-br from-gray-50 to-purple-50 hover:border-purple-600 hover:bg-purple-100'
                }`}
              >
                <div className="text-6xl mb-5">📄</div>
                <h3 className="text-2xl font-semibold text-gray-800 mb-3">
                  {selectedFiles.length > 0 
                    ? `✓ ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} selected` 
                    : 'Drag & Drop Your Statements'}
                </h3>
                <p className="text-gray-600 text-lg">
                  {selectedFiles.length > 0 
                    ? 'Click to add more files or process selected files' 
                    : 'or click to browse (Multiple files supported - PDF, Word, Images)'}
                </p>
                <input
                  type="file"
                  id="fileInput"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  multiple
                  onChange={(e) => {
                    console.log('File input changed:', e.target.files?.length, 'files');
                    handleFileSelect(e.target.files);
                    e.target.value = ''; // Reset input so same file can be selected again
                  }}
                />
              </div>

              {/* Selected Files List */}
              {selectedFiles.length > 0 && (
                <div className="mt-6 bg-gray-50 rounded-xl p-6">
                  <h4 className="font-semibold text-gray-800 mb-4">Selected Files:</h4>
                  <div className="space-y-2">
                    {selectedFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between bg-white p-3 rounded-lg shadow-sm">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">📄</span>
                          <span className="text-gray-700">{file.name}</span>
                          <span className="text-gray-400 text-sm">
                            ({(file.size / 1024 / 1024).toFixed(2)} MB)
                          </span>
                        </div>
                        <button
                          onClick={() => removeFile(index)}
                          className="text-red-500 hover:text-red-700 font-semibold"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded">
                  <p className="font-semibold">Error:</p>
                  <p>{error}</p>
                </div>
              )}

              <div className="text-center mt-6">
                <button
                  onClick={processFiles}
                  disabled={selectedFiles.length === 0}
                  className="bg-gradient-to-r from-purple-600 to-purple-800 text-white px-12 py-4 rounded-xl text-xl font-semibold shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105"
                >
                  Process {selectedFiles.length} Statement{selectedFiles.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isProcessing && (
            <div className="text-center py-16">
              <div className="inline-block w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-6"></div>
              <p className="text-xl text-gray-700 font-semibold">{processingStatus}</p>
              <p className="text-gray-500 mt-3">Extracting transactions and categorizing income sources</p>
            </div>
          )}

          {/* Results Section */}
          {results.length > 0 && (
            <div>
              {/* Results Header */}
              <div className="flex justify-between items-center mb-8 pb-6 border-b-2">
                <h2 className="text-4xl font-bold text-gray-800">📊 Analysis Results</h2>
                <button
                  onClick={resetApp}
                  className="border-2 border-purple-600 text-purple-600 px-6 py-3 rounded-lg font-semibold hover:bg-purple-600 hover:text-white transition-all"
                >
                  New Analysis
                </button>
              </div>

              {/* Combined Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className="bg-gradient-to-br from-purple-600 to-purple-800 text-white p-8 rounded-2xl shadow-lg">
                  <h3 className="text-sm uppercase tracking-wider opacity-90 mb-3">Total Income (All Files)</h3>
                  <div className="text-4xl font-bold mb-2">
                    ${combinedTotals.totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm opacity-80">{results.length} statement{results.length > 1 ? 's' : ''} analyzed</div>
                </div>

                <div className="bg-gradient-to-br from-purple-600 to-purple-800 text-white p-8 rounded-2xl shadow-lg">
                  <h3 className="text-sm uppercase tracking-wider opacity-90 mb-3">Total Transactions</h3>
                  <div className="text-4xl font-bold mb-2">{combinedTotals.totalTransactions}</div>
                  <div className="text-sm opacity-80">All income sources identified</div>
                </div>

                <div className="bg-gradient-to-br from-purple-600 to-purple-800 text-white p-8 rounded-2xl shadow-lg">
                  <h3 className="text-sm uppercase tracking-wider opacity-90 mb-3">Files Processed</h3>
                  <div className="text-4xl font-bold mb-2">{results.length}</div>
                  <div className="text-sm opacity-80">
                    {results.filter(r => r.data).length} successful, {results.filter(r => r.error).length} failed
                  </div>
                </div>
              </div>

              {/* Individual File Results */}
              {results.map((result, resultIdx) => (
                <div key={resultIdx} className="mb-10">
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6 rounded-t-2xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-3xl">📄</span>
                        <div>
                          <h3 className="text-2xl font-bold">{result.fileName}</h3>
                          {result.data && (
                            <p className="text-sm opacity-90">
                              Total: ${result.data.totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })} | 
                              Transactions: {result.data.totalTransactions}
                            </p>
                          )}
                        </div>
                      </div>
                      {result.error && (
                        <span className="bg-red-500 text-white px-4 py-2 rounded-full text-sm font-semibold">
                          Error
                        </span>
                      )}
                      {result.data && (
                        <span className="bg-green-500 text-white px-4 py-2 rounded-full text-sm font-semibold">
                          Success
                        </span>
                      )}
                    </div>
                  </div>

                  {result.error && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-b-2xl">
                      <p className="text-red-700 font-semibold">Error: {result.error}</p>
                    </div>
                  )}

                  {result.data && (
                    <div className="bg-gray-50 p-6 rounded-b-2xl border-2 border-gray-200">
                      {/* Monthly Breakdown */}
                      {result.data.months?.map((month: any, idx: number) => (
                        <div key={idx} className="bg-white rounded-xl p-6 mb-4 shadow-sm">
                          {/* Month Header */}
                          <div className="flex justify-between items-center mb-4 pb-3 border-b-2">
                            <h4 className="text-xl font-bold text-gray-800">📅 {month.month}</h4>
                            <div className="bg-gradient-to-r from-purple-600 to-purple-800 text-white px-4 py-2 rounded-lg text-lg font-bold">
                              ${month.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </div>
                          </div>

                          {/* Category Breakdown */}
                          <h5 className="text-xs uppercase tracking-wider text-gray-600 mb-3">Category Breakdown</h5>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                            {Object.entries(month.categories).map(([catName, catData]: [string, any]) => (
                              <div key={catName} className="bg-gray-50 p-4 rounded-lg border-l-4 border-purple-600">
                                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">{catName}</div>
                                <div className="text-xl font-bold text-gray-800">
                                  ${catData.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                  {catData.count} transaction{catData.count > 1 ? 's' : ''}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Transaction Table */}
                          <h5 className="text-xs uppercase tracking-wider text-gray-600 mb-3">Transaction Details</h5>
                          <div className="bg-white rounded-lg overflow-hidden shadow-sm border">
                            <table className="w-full">
                              <thead className="bg-gradient-to-r from-purple-600 to-purple-800 text-white">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Date</th>
                                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Type</th>
                                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Source</th>
                                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {month.transactions.map((tx: any, txIdx: number) => (
                                  <tr key={txIdx} className="border-b hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-800 text-sm">{tx.date}</td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${getTransactionTypeClass(tx.type)}`}>
                                        {tx.type}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-800 text-sm">{tx.source}</td>
                                    <td className="px-4 py-3 text-green-600 font-bold text-sm">
                                      ${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .type-deposit {
          background-color: #d1f4e0;
          color: #0d9e4a;
        }
        .type-ach {
          background-color: #cfe2ff;
          color: #084298;
        }
        .type-zelle {
          background-color: #f8d7da;
          color: #842029;
        }
        .type-wire {
          background-color: #fff3cd;
          color: #856404;
        }
        .type-transfer {
          background-color: #e7d4f8;
          color: #6f42c1;
        }
      `}</style>
    </div>
  );
}