---
title: Linux常用命令
description: 整理了Linux系统中常用的命令，方便日常开发使用。
date: 2023-06-10
category: Linux
tags: [Linux, 命令行]
cover: /images/reference/deaimon/cover-linux.jpg
---

# Linux常用命令

整理了Linux系统中常用的命令，方便日常开发使用。

## 文件操作

```bash
# 查看文件
ls -la

# 创建目录
mkdir -p /path/to/dir

# 复制文件
cp -r source/ destination/

# 移动/重命名
mv oldname newname
```

## 系统信息

```bash
# 查看系统信息
uname -a

# 查看磁盘使用
df -h

# 查看内存使用
free -h

# 查看进程
ps aux | grep process_name
```

## 网络工具

```bash
# 查看网络连接
netstat -tuln

# 测试连通性
ping example.com

# 下载文件
wget https://example.com/file.zip
```

## 总结

掌握这些常用命令可以大大提高开发效率，建议多加练习。
