FROM postgres:18-alpine
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh
CMD ["sh", "/backup.sh"]
