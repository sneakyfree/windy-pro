# Windy Pro Translation Engine Benchmark Report

**Model:** M2M-100-418M
**Date:** 2026-03-09 12:24:14
**Device:** cuda

## System Information

- Server Version: 0.1.0
- Model Loaded: True
- Device: cuda

### VRAM Usage (Initial)

- Allocated: 1863.1 MB
- Reserved: 1916.0 MB

## Performance Summary

- **Total Tests:** 10
- **Successful:** 10
- **Failed:** 0
- **Average Inference Time:** 117.1ms
- **Average Round-Trip Time:** 118.1ms
- **Average Throughput:** 138.5 tokens/sec

## Test Results

| # | Language Pair | Input | Output | Inference (ms) | Round-Trip (ms) | Tokens/sec |
|---|---------------|-------|--------|----------------|-----------------|------------|
| 1 | en → ru | - | Здравствуйте, мое имя Сара, и я работаю инженером ... | 149 | 150 | 147.65 |
| 2 | ru → en | - | I am studying programming. | 115 | 116 | 86.96 |
| 3 | pt → fi | - | Rakastan paljon musiikkia ja taidetta. | 99 | 100 | 141.41 |
| 4 | fi → pt | - | Bom dia, eu gosto de viajar. | 79 | 80 | 151.9 |
| 5 | en → es | - | El tiempo es hermoso hoy, perfecto para un paseo e... | 145 | 146 | 144.83 |
| 6 | es → en | - | I like Italian food, especially pasta. | 86 | 87 | 127.91 |
| 7 | zh → en | - | Hello, I am glad to see you.I am from Beijing. | 111 | 112 | 153.15 |
| 8 | en → ar | - | مرحبا بكم في شركتنا ونحن سعداء أن يكون لكم هنا. | 130 | 131 | 153.85 |
| 9 | ja → de | - | Hallo, bist du gut, das Wetter ist gut. | 107 | 108 | 130.84 |
| 10 | ko → fr | - | Bonjour, je suis heureux de vous rencontrer, je su... | 150 | 151 | 146.67 |

## VRAM Usage (Final)

- **Allocated:** 1863.1 MB
- **Reserved:** 1936.0 MB
- **Peak:** 1915.7 MB

## Conclusion

The M2M-100-418M model demonstrates solid baseline performance for text-to-text translation across multiple language pairs. 
GPU acceleration provides significant speedup compared to CPU inference.
